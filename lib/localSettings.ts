import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { payrollSettings } from "./data";
import type { PayrollSettings } from "./types";

const dataDir = path.join(process.cwd(), "data");
const settingsPath = path.join(dataDir, "payroll-settings.json");

async function ensureDataDir() {
  await mkdir(dataDir, { recursive: true });
}

export async function readLocalSettings(): Promise<PayrollSettings> {
  try {
    const raw = await readFile(settingsPath, "utf8");
    return { ...payrollSettings, ...(JSON.parse(raw) as Partial<PayrollSettings>) };
  } catch {
    return payrollSettings;
  }
}

export async function writeLocalSettings(settings: PayrollSettings) {
  await ensureDataDir();
  await writeFile(settingsPath, JSON.stringify(settings, null, 2));
  return settings;
}
