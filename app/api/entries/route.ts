import { NextResponse } from "next/server";
import { appendEntryToGoogleSheets } from "@/lib/googleSheets";
import { readLocalEntries, upsertLocalEntry } from "@/lib/localEntries";
import type { DailyEntry } from "@/lib/types";

export async function GET() {
  const entries = await readLocalEntries();
  return NextResponse.json({ entries });
}

export async function POST(request: Request) {
  const entry = (await request.json()) as DailyEntry;
  await upsertLocalEntry(entry);
  const syncSheets = new URL(request.url).searchParams.get("syncSheets") !== "false";
  const sheetsResult = syncSheets
    ? await appendEntryToGoogleSheets(entry)
    : { configured: false, message: "Google Sheets sync skipped for existing entry migration." };

  return NextResponse.json({
    ok: true,
    entry,
    sheets: sheetsResult
  });
}
