import { NextResponse } from "next/server";
import { deleteLocalPalletType, updateLocalPalletType } from "@/lib/localPalletTypes";
import { getSupabaseServerClient } from "@/lib/supabase";
import type { PalletType } from "@/lib/types";

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
  const { id } = await params;
  const supabase = getSupabaseServerClient();
  const patch = (await request.json()) as Partial<PalletType>;

  if (!supabase) {
    const palletType = await updateLocalPalletType(id, patch);
    return NextResponse.json({ configured: false, storage: "local", id, palletType });
  }

  const { error } = await supabase.from("pallet_types").update(toPatch(patch)).eq("id", id);

  if (error) {
    return NextResponse.json({ configured: true, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ configured: true, id });
}

export async function DELETE(_request: Request, { params }: Params) {
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
