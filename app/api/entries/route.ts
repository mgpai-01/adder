import { NextResponse } from "next/server";
import { appendEntryToGoogleSheets } from "@/lib/googleSheets";
import { isCloudEntriesConfigured, readCloudEntries, upsertCloudEntry } from "@/lib/cloudEntries";
import { readLocalEntries, upsertLocalEntry } from "@/lib/localEntries";
import type { DailyEntry } from "@/lib/types";
import { denyUnless } from "@/lib/apiAuth";

export async function GET(request: Request) {
  const denied = await denyUnless(request);
  if (denied) return denied;

  if (isCloudEntriesConfigured()) {
    const entries = await readCloudEntries();
    return NextResponse.json({ entries, storage: "cloud" });
  }

  const entries = await readLocalEntries();
  return NextResponse.json({ entries, storage: "local" });
}

export async function POST(request: Request) {
  const denied = await denyUnless(request);
  if (denied) return denied;

  const entry = (await request.json()) as DailyEntry;

  if (isCloudEntriesConfigured()) {
    const result = await upsertCloudEntry(entry);
    return NextResponse.json({ ok: result.ok, entry, storage: "cloud", error: result.error });
  }

  await upsertLocalEntry(entry);
  const syncSheets = new URL(request.url).searchParams.get("syncSheets") !== "false";
  const sheetsResult = syncSheets
    ? await appendEntryToGoogleSheets(entry)
    : { configured: false, message: "Google Sheets sync skipped for existing entry migration." };

  return NextResponse.json({
    ok: true,
    entry,
    storage: "local",
    sheets: sheetsResult
  });
}
