import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { saveLocalEntryPhotos } from "@/lib/localEntryPhotos";

// Uploads Daily Grid phase photos and returns small URLs, so the entry itself
// stores only links instead of heavy base64 image data. Embedding photos in the
// entry JSON pushed the save payload past the cloud's size limit, which made
// entries-with-photos silently fail to persist. Reuses the existing public
// "count-sheets" storage bucket under an entry-photos/ prefix when Supabase is
// configured, and falls back to local disk otherwise.
export async function POST(request: Request) {
  const supabase = getSupabaseServerClient();
  const formData = await request.formData();
  const files = formData.getAll("photos").filter((value): value is File => value instanceof File);
  const scope = String(formData.get("scope") ?? "misc").replace(/[^a-zA-Z0-9._-]/g, "-") || "misc";

  if (files.length === 0) {
    return NextResponse.json({ urls: [] });
  }

  if (!supabase) {
    const urls = await saveLocalEntryPhotos(files, scope);
    return NextResponse.json({ configured: false, storage: "local", urls });
  }

  const urls: string[] = [];
  for (const file of files) {
    const safeName = (file.name || "photo.jpg").replace(/[^a-zA-Z0-9._-]/g, "-");
    const storagePath = `entry-photos/${scope}/${crypto.randomUUID()}-${safeName}`;
    const { error } = await supabase.storage.from("count-sheets").upload(storagePath, file, {
      contentType: file.type || "image/jpeg",
      upsert: false
    });
    if (error) {
      return NextResponse.json({ configured: true, error: error.message }, { status: 500 });
    }
    const { data } = supabase.storage.from("count-sheets").getPublicUrl(storagePath);
    urls.push(data.publicUrl);
  }

  return NextResponse.json({ configured: true, storage: "cloud", urls });
}
