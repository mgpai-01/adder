import { NextResponse } from "next/server";
import { deleteLocalCountSheet, normalizeStatus, updateLocalCountSheet } from "@/lib/localCountSheets";
import { getSupabaseServerClient } from "@/lib/supabase";
import type { CountSheetStatus } from "@/lib/types";
import { denyUnless } from "@/lib/apiAuth";

type PatchBody = {
  status?: CountSheetStatus;
  notes?: string;
  comments?: string;
  updatedBy?: string;
};

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = getSupabaseServerClient();
  const { id } = await params;
  const body = (await request.json()) as PatchBody;

  if (!supabase) {
    const localPatch = {
      ...(normalizeStatus(body.status) ? { status: normalizeStatus(body.status) } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
      ...(body.comments !== undefined ? { comments: body.comments } : {}),
      updatedBy: body.updatedBy ?? "Admin"
    };
    await updateLocalCountSheet(id, localPatch);
    return NextResponse.json({ configured: false, storage: "local" });
  }

  const now = new Date().toISOString();
  const patch: Record<string, string | null> = {
    updated_at: now,
    updated_by: body.updatedBy ?? "Admin"
  };

  if (body.notes !== undefined) patch.notes = body.notes;
  if (body.comments !== undefined) patch.comments = body.comments;
  if (body.status !== undefined) {
    patch.status = body.status;
    if (body.status === "Approved") {
      patch.approved_by = body.updatedBy ?? "Admin";
      patch.approved_at = now;
      patch.rejected_by = null;
      patch.rejected_at = null;
    }
    if (body.status === "Rejected") {
      patch.rejected_by = body.updatedBy ?? "Admin";
      patch.rejected_at = now;
      patch.approved_by = null;
      patch.approved_at = null;
    }
  }

  const { error } = await supabase.from("count_sheets").update(patch).eq("id", id);

  if (error) {
    return NextResponse.json({ configured: true, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ configured: true });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await denyUnless(request, ["admin"]);
  if (denied) return denied;

  const supabase = getSupabaseServerClient();
  const { id } = await params;

  if (!supabase) {
    await deleteLocalCountSheet(id);
    return NextResponse.json({ configured: false, storage: "local" });
  }

  const { data: photos } = await supabase.from("count_sheet_photos").select("storage_path").eq("count_sheet_id", id);
  const paths = (photos ?? []).map((photo) => photo.storage_path).filter(Boolean);
  if (paths.length > 0) {
    await supabase.storage.from("count-sheets").remove(paths);
  }

  const { error } = await supabase.from("count_sheets").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ configured: true, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ configured: true });
}
