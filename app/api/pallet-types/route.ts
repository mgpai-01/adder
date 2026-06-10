import { NextResponse } from "next/server";
import { createLocalPalletType, readLocalPalletTypes } from "@/lib/localPalletTypes";
import { getSupabaseServerClient } from "@/lib/supabase";
import type { PalletType } from "@/lib/types";

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

export async function GET() {
  const supabase = getSupabaseServerClient();

  if (!supabase) {
    const palletTypes = await readLocalPalletTypes();
    return NextResponse.json({ configured: false, storage: "local", palletTypes });
  }

  const { data, error } = await supabase
    .from("pallet_types")
    .select("id, code, description, category, repair_rate, photo_url, active, bilingual_label, customer_rate_note, location_rate_note")
    .order("category", { ascending: true })
    .order("code", { ascending: true });

  if (error) {
    return NextResponse.json({ configured: true, error: error.message, palletTypes: [] }, { status: 500 });
  }

  return NextResponse.json({ configured: true, palletTypes: (data as PalletTypeRow[]).map(fromRow) });
}

export async function POST(request: Request) {
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
