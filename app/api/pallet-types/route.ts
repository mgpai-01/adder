import { NextResponse } from "next/server";
import { createLocalPalletType, readLocalPalletTypes } from "@/lib/localPalletTypes";
import { getSupabaseServerClient } from "@/lib/supabase";
import type { PalletType } from "@/lib/types";
import { denyUnless } from "@/lib/apiAuth";

type PalletTypeRow = {
  id: string;
  code: string;
  description: string | null;
  category: PalletType["category"];
  repair_rate: number | string;
  photo_url: string | null;
  active: boolean;
  bilingual_label: string | null;
  customer_rate_note: string | null;
  location_rate_note: string | null;
};

function fromRow(row: PalletTypeRow): PalletType {
  return {
    id: row.id,
    code: row.code,
    description: row.description ?? "",
    category: row.category,
    rate: Number(row.repair_rate),
    active: row.active,
    photoUrl: row.photo_url ?? undefined,
    bilingualLabel: row.bilingual_label ?? undefined,
    customerRateNote: row.customer_rate_note ?? undefined,
    locationRateNote: row.location_rate_note ?? undefined
  };
}

function toRow(palletType: Omit<PalletType, "id">) {
  return {
    code: palletType.code,
    description: palletType.description,
    category: palletType.category,
    repair_rate: palletType.rate,
    photo_url: palletType.photoUrl || null,
    active: palletType.active,
    bilingual_label: palletType.bilingualLabel || null,
    customer_rate_note: palletType.customerRateNote || null,
    location_rate_note: palletType.locationRateNote || null
  };
}

// The live board is a public display, so this stays readable without a session
// — but the dollar rates do not. A signed-out caller gets the pallet list with
// rate (and the rate notes) stripped, which is everything the board needs to
// label columns and tell a QC deduction from production.
function withoutRates(palletTypes: PalletType[]): PalletType[] {
  return palletTypes.map(({ rate: _rate, customerRateNote: _customer, locationRateNote: _location, ...rest }) => ({
    ...rest,
    rate: 0
  }));
}

export async function GET(request: Request) {
  const supabase = getSupabaseServerClient();
  const signedOut = Boolean(await denyUnless(request));

  if (!supabase) {
    const palletTypes = await readLocalPalletTypes();
    return NextResponse.json({ configured: false, storage: "local", palletTypes: signedOut ? withoutRates(palletTypes) : palletTypes });
  }

  const { data, error } = await supabase
    .from("pallet_types")
    .select("id, code, description, category, repair_rate, photo_url, active, bilingual_label, customer_rate_note, location_rate_note")
    .order("category", { ascending: true })
    .order("code", { ascending: true });

  if (error) {
    return NextResponse.json({ configured: true, error: error.message, palletTypes: [] }, { status: 500 });
  }

  const palletTypes = (data as PalletTypeRow[]).map(fromRow);
  return NextResponse.json({ configured: true, palletTypes: signedOut ? withoutRates(palletTypes) : palletTypes });
}

export async function POST(request: Request) {
  const denied = await denyUnless(request, ["admin"]);
  if (denied) return denied;

  const supabase = getSupabaseServerClient();
  const palletType = (await request.json()) as Omit<PalletType, "id">;

  if (!supabase) {
    const saved = await createLocalPalletType(palletType);
    return NextResponse.json({ configured: false, storage: "local", palletType: saved });
  }

  const { data, error } = await supabase
    .from("pallet_types")
    .insert(toRow(palletType))
    .select("id, code, description, category, repair_rate, photo_url, active, bilingual_label, customer_rate_note, location_rate_note")
    .single();

  if (error) {
    return NextResponse.json({ configured: true, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ configured: true, palletType: fromRow(data as PalletTypeRow) });
}
