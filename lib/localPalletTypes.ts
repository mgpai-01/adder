import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { defaultPalletTypes } from "./data";
import type { PalletType } from "./types";

const dataDir = path.join(process.cwd(), "data");
const palletTypesPath = path.join(dataDir, "pallet-types.json");

async function ensureDataDir() {
  await mkdir(dataDir, { recursive: true });
}

async function writeLocalPalletTypes(palletTypes: PalletType[]) {
  await ensureDataDir();
  await writeFile(palletTypesPath, JSON.stringify(palletTypes, null, 2));
}

export async function readLocalPalletTypes(): Promise<PalletType[]> {
  try {
    const raw = await readFile(palletTypesPath, "utf8");
    const palletTypes = JSON.parse(raw) as PalletType[];
    return palletTypes.length > 0 ? palletTypes : defaultPalletTypes;
  } catch {
    return defaultPalletTypes;
  }
}

export async function createLocalPalletType(palletType: Omit<PalletType, "id">) {
  const existing = await readLocalPalletTypes();
  const nextPalletType: PalletType = { ...palletType, id: `pallet-${Date.now()}` };
  await writeLocalPalletTypes([...existing, nextPalletType]);
  return nextPalletType;
}

export async function updateLocalPalletType(id: string, patch: Partial<PalletType>) {
  const existing = await readLocalPalletTypes();
  const updated = existing.map((palletType) => (palletType.id === id ? { ...palletType, ...patch } : palletType));
  await writeLocalPalletTypes(updated);
  return updated.find((palletType) => palletType.id === id);
}

export async function deleteLocalPalletType(id: string) {
  const existing = await readLocalPalletTypes();
  await writeLocalPalletTypes(existing.filter((palletType) => palletType.id !== id));
}
