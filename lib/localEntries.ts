import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DailyEntry } from "./types";

const dataDir = path.join(process.cwd(), "data");
const entriesPath = path.join(dataDir, "production-entries.json");
const entriesTempPath = path.join(dataDir, "production-entries.tmp.json");
let writeQueue: Promise<unknown> = Promise.resolve();

async function ensureDataDir() {
  await mkdir(dataDir, { recursive: true });
}

export async function readLocalEntries(): Promise<DailyEntry[]> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const raw = await readFile(entriesPath, "utf8");
      return JSON.parse(raw) as DailyEntry[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      if (attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  return [];
}

async function writeLocalEntries(entries: DailyEntry[]) {
  await ensureDataDir();
  await writeFile(entriesTempPath, JSON.stringify(entries, null, 2));
  await rename(entriesTempPath, entriesPath);
}

async function withEntryWriteLock<T>(operation: () => Promise<T>) {
  const next = writeQueue.then(operation, operation);
  writeQueue = next.catch(() => undefined);
  return next;
}

export async function upsertLocalEntry(entry: DailyEntry) {
  return withEntryWriteLock(async () => {
    const entries = await readLocalEntries();
    const existingIndex = entries.findIndex((item) => item.id === entry.id);
    const nextEntries = [...entries];

    if (existingIndex >= 0) {
      nextEntries[existingIndex] = entry;
    } else {
      nextEntries.unshift(entry);
    }

    await writeLocalEntries(nextEntries);
    return entry;
  });
}

export async function deleteLocalEntry(id: string) {
  await withEntryWriteLock(async () => {
    const entries = await readLocalEntries();
    await writeLocalEntries(entries.filter((entry) => entry.id !== id));
  });
}
