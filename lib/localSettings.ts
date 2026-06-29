import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { payrollSettings } from "./data";
import type { PayrollSettings } from "./types";

// On serverless hosts (Vercel) the project directory is read-only — only the
// OS temp dir is writable. Use a writable location so settings writes don't
// crash the request. (Note: temp storage is ephemeral; durable settings should
// live in the cloud database, but this keeps the API from 500-ing.)
const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const dataDir = isServerless ? path.join(os.tmpdir(), "mgp-data") : path.join(process.cwd(), "data");
const settingsPath = path.join(dataDir, "payroll-settings.json");

export async function readLocalSettings(): Promise<PayrollSettings> {
  try {
    const raw = await readFile(settingsPath, "utf8");
    return { ...payrollSettings, ...(JSON.parse(raw) as Partial<PayrollSettings>) };
  } catch {
    return payrollSettings;
  }
}

export async function writeLocalSettings(settings: PayrollSettings) {
  // Best-effort persistence: never throw if the filesystem is read-only, so the
  // settings API responds 200 instead of crashing the page that called it.
  try {
    await mkdir(dataDir, { recursive: true });
    await writeFile(settingsPath, JSON.stringify(settings, null, 2));
  } catch {
    // Read-only FS (or similar) — accept the settings without persisting.
  }
  return settings;
}
