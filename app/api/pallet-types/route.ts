import { NextResponse } from "next/server";
import { createLocalPalletType, readLocalPalletTypes } from "@/lib/localPalletTypes";
import { getSupabaseServerClient } from "@/lib/supabase";
import type { PalletType } from "@/lib/types";
import { denyUnless } from "@/lib/apiAuth";
import { FALLBACK_CATEGORY, fallbackNote, friendlyPalletError, isCategoryRejected } from "@/lib/palletTypeSave";

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

export async function GET(request: Request) {
  const denied = await denyUnless(request);
  if (denied) return denied;

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
  const denied = await denyUnless(request, ["admin"]);
  if (denied) return denied;

  const supabase = getSupabaseServerClient();
  const palletType = (await request.json()) as Omit<PalletType, "id">;

  if (!supabase) {
    const saved = await createLocalPalletType(palletType);
    return NextResponse.json({ configured: false, storage: "local", palletType: saved });
  }

  const columns = "id, code, description, category, repair_rate, photo_url, active, bilingual_label, customer_rate_note, location_rate_note";
  let warning = "";
  let { data, error } = await supabase.from("pallet_types").insert(toRow(palletType)).select(columns).single();

  // The database's category list may not have the one picked (e.g. "Custom"
  // before supabase/custom-category-migration.sql is run): save it under one
  // it accepts rather than losing the pallet — see lib/palletTypeSave.
  if (error && isCategoryRejected(error.message) && palletType.category !== FALLBACK_CATEGORY) {
    warning = fallbackNote(palletType.category);
    ({ data, error } = await supabase
      .from("pallet_types")
      .insert(toRow({ ...palletType, category: FALLBACK_CATEGORY }))
      .select(columns)
      .single());
  }

  if (error || !data) {
    return NextResponse.json(
      { configured: true, error: friendlyPalletError(error?.message ?? "Save failed", palletType.code) },
      { status: error && /duplicate key|unique constraint/i.test(error.message) ? 409 : 500 }
    );
  }

  return NextResponse.json({ configured: true, palletType: fromRow(data as PalletTypeRow), ...(warning ? { warning } : {}) });
}
