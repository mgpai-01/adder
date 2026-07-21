import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

// Local-disk fallback for entry (Daily Grid phase) photos when Supabase Storage
// isn't configured. Mirrors how local count-sheet photos are stored: write the
// file under public/uploads so Next.js serves it, and return that public path.
// This keeps photos out of the entry JSON (which the cloud caps in size) in both
// environments.
const uploadRoot = path.join(process.cwd(), "public", "uploads", "entry-photos");

function safeSegment(value: string) {
  return (value || "misc").replace(/[^a-zA-Z0-9._-]/g, "-");
}

export async function saveLocalEntryPhotos(files: File[], scope: string): Promise<string[]> {
  const folderName = safeSegment(scope);
  const folder = path.join(uploadRoot, folderName);
  await mkdir(folder, { recursive: true });

  const urls: string[] = [];
  for (const file of files) {
    const name = `${crypto.randomUUID()}-${safeSegment(file.name || "photo.jpg")}`;
    await writeFile(path.join(folder, name), Buffer.from(await file.arrayBuffer()));
    urls.push(`/uploads/entry-photos/${folderName}/${name}`);
  }
  return urls;
}
