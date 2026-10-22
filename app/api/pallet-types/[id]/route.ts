import { NextResponse } from "next/server";
import { deleteLocalPalletType, updateLocalPalletType } from "@/lib/localPalletTypes";
import { getSupabaseServerClient } from "@/lib/supabase";
import type { PalletType } from "@/lib/types";
import { denyUnless } from "@/lib/apiAuth";
import { FALLBACK_CATEGORY, fallbackNote, friendlyPalletError, isCategoryRejected } from "@/lib/palletTypeSave";

type Params = {
  params: Promise<{
    id: string;
  }>;
};

function toPatch(palletType: Partial<PalletType>) {
  return {
    ...(palletType.code !== undefined ? { code: palletType.code } : {}),
    ...(palletType.description !== undefined ? { description: palletType.description } : {}),
    ...(palletType.category !== undefined ? { category: palletType.category } : {}),
    ...(palletType.rate !== undefined ? { repair_rate: palletType.rate } : {}),
    ...(palletType.photoUrl !== undefined ? { photo_url: palletType.photoUrl || null } : {}),
    ...(palletType.active !== undefined ? { active: palletType.active } : {}),
    ...(palletType.bilingualLabel !== undefined ? { bilingual_label: palletType.bilingualLabel || null } : {}),
    ...(palletType.customerRateNote !== undefined ? { customer_rate_note: palletType.customerRateNote || null } : {}),
    ...(palletType.locationRateNote !== undefined ? { location_rate_note: palletType.locationRateNote || null } : {})
  };
}

export async function PATCH(request: Request, { params }: Params) {
  const denied = await denyUnless(request, ["admin"]);
  if (denied) return denied;

  const { id } = await params;
  const supabase = getSupabaseServerClient();
  const patch = (await request.json()) as Partial<PalletType>;

  if (!supabase) {
    const palletType = await updateLocalPalletType(id, patch);
    return NextResponse.json({ configured: false, storage: "local", id, palletType });
  }

  let warning = "";
  let { error } = await supabase.from("pallet_types").update(toPatch(patch)).eq("id", id);

  // Same as creating: a category the database doesn't have yet is saved under
  // one it accepts instead of failing the whole edit (lib/palletTypeSave).
  if (error && isCategoryRejected(error.message) && patch.category && patch.category !== FALLBACK_CATEGORY) {
    warning = fallbackNote(patch.category);
    ({ error } = await supabase.from("pallet_types").update(toPatch({ ...patch, category: FALLBACK_CATEGORY })).eq("id", id));
  }

  if (error) {
    return NextResponse.json(
      { configured: true, error: friendlyPalletError(error.message, patch.code) },
      { status: /duplicate key|unique constraint/i.test(error.message) ? 409 : 500 }
    );
  }

  return NextResponse.json({ configured: true, id, ...(warning ? { warning, category: FALLBACK_CATEGORY } : {}) });
}

export async function DELETE(request: Request, { params }: Params) {
  const denied = await denyUnless(request, ["admin"]);
  if (denied) return denied;

  const { id } = await params;
  const supabase = getSupabaseServerClient();

  if (!supabase) {
    await deleteLocalPalletType(id);
    return NextResponse.json({ configured: false, storage: "local", id });
  }

  const { error } = await supabase.from("pallet_types").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ configured: true, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ configured: true, id });
}
