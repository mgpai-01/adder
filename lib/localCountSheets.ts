import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CountSheet, CountSheetPhoto, CountSheetStatus, Shift } from "./types";

const dataDir = path.join(process.cwd(), "data");
const uploadRoot = path.join(process.cwd(), "public", "uploads", "count-sheets");
const dbPath = path.join(dataDir, "count-sheets.json");

async function ensureLocalDirs() {
  await mkdir(dataDir, { recursive: true });
  await mkdir(uploadRoot, { recursive: true });
}

function safeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "-");
}

export async function readLocalCountSheets(): Promise<CountSheet[]> {
  try {
    const raw = await readFile(dbPath, "utf8");
    return JSON.parse(raw) as CountSheet[];
  } catch {
    return [];
  }
}

async function writeLocalCountSheets(countSheets: CountSheet[]) {
  await ensureLocalDirs();
  await writeFile(dbPath, JSON.stringify(countSheets, null, 2));
}

export async function createLocalCountSheet(input: {
  date: string;
  locationId: string;
  shift: Shift;
  uploadedBy: string;
  notes: string;
  files: File[];
}) {
  await ensureLocalDirs();

  const id = `count-${crypto.randomUUID()}`;
  const uploadTime = new Date().toISOString();
  const folder = path.join(uploadRoot, input.date, input.locationId, input.shift, id);
  await mkdir(folder, { recursive: true });

  const photos: CountSheetPhoto[] = [];

  for (const file of input.files) {
    const fileId = `photo-${crypto.randomUUID()}`;
    const fileName = `${fileId}-${safeFileName(file.name || "count-sheet.jpg")}`;
    const diskPath = path.join(folder, fileName);
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(diskPath, buffer);

    const publicPath = `/uploads/count-sheets/${input.date}/${input.locationId}/${input.shift}/${id}/${fileName}`;
    photos.push({
      id: fileId,
      fileName: file.name || fileName,
      url: publicPath,
      storagePath: publicPath,
      uploadedAt: uploadTime,
      size: file.size,
      contentType: file.type || "image/jpeg"
    });
  }

  const countSheet: CountSheet = {
    id,
    date: input.date,
    locationId: input.locationId,
    shift: input.shift,
    uploadedBy: input.uploadedBy || "Counter",
    uploadTime,
    notes: input.notes,
    status: "Pending",
    comments: "",
    photos
  };

  const existing = await readLocalCountSheets();
  await writeLocalCountSheets([countSheet, ...existing]);
  return countSheet;
}

export async function updateLocalCountSheet(id: string, patch: Partial<CountSheet>) {
  const now = new Date().toISOString();
  const existing = await readLocalCountSheets();
  const updated = existing.map((sheet) => {
    if (sheet.id !== id) return sheet;
    const nextStatus = patch.status;
    return {
      ...sheet,
      ...patch,
      updatedAt: now,
      updatedBy: patch.updatedBy ?? "Admin",
      approvedBy: nextStatus === "Approved" ? patch.approvedBy ?? "Admin" : sheet.approvedBy,
      approvedAt: nextStatus === "Approved" ? patch.approvedAt ?? now : sheet.approvedAt,
      rejectedBy: nextStatus === "Rejected" ? patch.rejectedBy ?? "Admin" : sheet.rejectedBy,
      rejectedAt: nextStatus === "Rejected" ? patch.rejectedAt ?? now : sheet.rejectedAt
    };
  });

  await writeLocalCountSheets(updated);
}

export async function deleteLocalCountSheet(id: string) {
  const existing = await readLocalCountSheets();
  const sheet = existing.find((item) => item.id === id);
  const updated = existing.filter((item) => item.id !== id);
  await writeLocalCountSheets(updated);

  if (sheet) {
    await rm(path.join(uploadRoot, sheet.date, sheet.locationId, sheet.shift, sheet.id), { recursive: true, force: true });
  }
}

export function normalizeStatus(status: unknown): CountSheetStatus | undefined {
  return status === "Pending" || status === "Approved" || status === "Rejected" ? status : undefined;
}
