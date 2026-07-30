import { NextResponse } from "next/server";
import { createLocalCountSheet, readLocalCountSheets } from "@/lib/localCountSheets";
import { getSupabaseServerClient } from "@/lib/supabase";
import type { CountSheet, CountSheetStatus, Shift } from "@/lib/types";
import { denyUnless } from "@/lib/apiAuth";

type CountSheetRow = {
  id: string;
  sheet_date: string;
  location_id: string;
  shift: Shift;
  uploaded_by: string | null;
  upload_time: string;
  notes: string | null;
  status: CountSheetStatus;
  comments: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  updated_at: string | null;
  updated_by: string | null;
  count_sheet_photos?: CountSheetPhotoRow[];
};

type CountSheetPhotoRow = {
  id: string;
  file_name: string;
  storage_path: string;
  public_url: string;
  uploaded_at: string;
  size: number | null;
  content_type: string | null;
};

function fromRows(row: CountSheetRow): CountSheet {
  return {
    id: row.id,
    date: row.sheet_date,
    locationId: row.location_id,
    shift: row.shift,
    uploadedBy: row.uploaded_by ?? "Counter",
    uploadTime: row.upload_time,
    notes: row.notes ?? "",
    status: row.status,
    comments: row.comments ?? "",
    approvedBy: row.approved_by ?? undefined,
    approvedAt: row.approved_at ?? undefined,
    rejectedBy: row.rejected_by ?? undefined,
    rejectedAt: row.rejected_at ?? undefined,
    updatedAt: row.updated_at ?? undefined,
    updatedBy: row.updated_by ?? undefined,
    photos: (row.count_sheet_photos ?? []).map((photo) => ({
      id: photo.id,
      fileName: photo.file_name,
      url: photo.public_url,
      storagePath: photo.storage_path,
      uploadedAt: photo.uploaded_at,
      size: photo.size ?? undefined,
      contentType: photo.content_type ?? undefined
    }))
  };
}

export async function GET(request: Request) {
  const denied = await denyUnless(request);
  if (denied) return denied;

  const supabase = getSupabaseServerClient();

  if (!supabase) {
    const countSheets = await readLocalCountSheets();
    return NextResponse.json({ configured: false, storage: "local", countSheets });
  }

  const { data, error } = await supabase
    .from("count_sheets")
    .select("id, sheet_date, location_id, shift, uploaded_by, upload_time, notes, status, comments, approved_by, approved_at, rejected_by, rejected_at, updated_at, updated_by, count_sheet_photos(id, file_name, storage_path, public_url, uploaded_at, size, content_type)")
    .order("sheet_date", { ascending: false })
    .order("upload_time", { ascending: false });

  if (error) {
    return NextResponse.json({ configured: true, error: error.message, countSheets: [] }, { status: 500 });
  }

  return NextResponse.json({ configured: true, countSheets: (data as CountSheetRow[]).map(fromRows) });
}

export async function POST(request: Request) {
  const denied = await denyUnless(request);
  if (denied) return denied;

  const supabase = getSupabaseServerClient();
  const formData = await request.formData();
  const files = formData.getAll("photos").filter((value): value is File => value instanceof File);
  const date = String(formData.get("date") ?? "");
  const locationId = String(formData.get("locationId") ?? "");
  const shift = String(formData.get("shift") ?? "AM") as Shift;
  const uploadedBy = String(formData.get("uploadedBy") ?? "Counter");
  const notes = String(formData.get("notes") ?? "");
  const uploadTime = new Date().toISOString();

  if (!supabase) {
    const countSheet = await createLocalCountSheet({ date, locationId, shift, uploadedBy, notes, files });
    return NextResponse.json({ configured: false, storage: "local", countSheet });
  }

  const { data: sheet, error: sheetError } = await supabase
    .from("count_sheets")
    .insert({
      sheet_date: date,
      location_id: locationId,
      shift,
      uploaded_by: uploadedBy,
      upload_time: uploadTime,
      notes,
      status: "Pending"
    })
    .select("id, sheet_date, location_id, shift, uploaded_by, upload_time, notes, status, comments, approved_by, approved_at, rejected_by, rejected_at, updated_at, updated_by")
    .single();

  if (sheetError || !sheet) {
    return NextResponse.json({ configured: true, error: sheetError?.message ?? "Could not save count sheet." }, { status: 500 });
  }

  const photoRows: CountSheetPhotoRow[] = [];

  for (const file of files) {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
    const storagePath = `${date}/${locationId}/${shift}/${(sheet as CountSheetRow).id}/${crypto.randomUUID()}-${safeName}`;
    const { error: uploadError } = await supabase.storage.from("count-sheets").upload(storagePath, file, {
      contentType: file.type || "image/jpeg",
      upsert: false
    });

    if (uploadError) {
      return NextResponse.json({ configured: true, error: uploadError.message }, { status: 500 });
    }

    const { data: publicUrl } = supabase.storage.from("count-sheets").getPublicUrl(storagePath);
    const { data: photo, error: photoError } = await supabase
      .from("count_sheet_photos")
      .insert({
        count_sheet_id: (sheet as CountSheetRow).id,
        file_name: file.name,
        storage_path: storagePath,
        public_url: publicUrl.publicUrl,
        size: file.size,
        content_type: file.type || "image/jpeg"
      })
      .select("id, file_name, storage_path, public_url, uploaded_at, size, content_type")
      .single();

    if (photoError || !photo) {
      return NextResponse.json({ configured: true, error: photoError?.message ?? "Could not save photo metadata." }, { status: 500 });
    }

    photoRows.push(photo as CountSheetPhotoRow);
  }

  return NextResponse.json({
    configured: true,
    countSheet: fromRows({ ...(sheet as CountSheetRow), count_sheet_photos: photoRows })
  });
}
