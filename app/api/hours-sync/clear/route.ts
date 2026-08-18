import { NextResponse } from "next/server";
import { isCloudEntriesConfigured, readCloudEntries, upsertCloudEntry } from "@/lib/cloudEntries";
import type { DailyEntry } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// One-shot cleanup: removes every trace of AMG-imported hours from entries
// while leaving all other data (pallets, photos, notes) untouched. Used when
// the AMG sync was parked after some hours had already been applied.
//
// For each entry that carries importedHours:
// - importedHours is removed.
// - If manualHours still equals the imported figure (nobody touched it since
//   the import), manualHours goes back to 0 and breakProfile to "standard" —
//   the pre-import defaults. If a person changed the hours after the import,
//   their number is kept.
//
// Gated by CRON_SECRET (same secret as the nightly cron), accepted either as
// Authorization: Bearer <secret> or ?key=<secret> so it can be run from a
// browser. Idempotent: a second run finds nothing to clear.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const key = new URL(request.url).searchParams.get("key");
  const authorized = Boolean(secret) && (request.headers.get("authorization") === `Bearer ${secret}` || key === secret);
  if (!authorized) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!isCloudEntriesConfigured()) {
    return NextResponse.json({ ok: false, error: "Cloud storage not configured" }, { status: 503 });
  }

  const entries = await readCloudEntries();
  const now = new Date().toISOString();
  const cleared: Array<{ date: string; employeeId: string; hoursRemoved: number; manualHoursKept: number }> = [];

  for (const entry of entries) {
    if (entry.deleted || typeof entry.importedHours !== "number") continue;
    const untouchedSinceImport = entry.manualHours === entry.importedHours;
    const next: DailyEntry = {
      ...entry,
      manualHours: untouchedSinceImport ? 0 : entry.manualHours,
      breakProfile: untouchedSinceImport ? "standard" : entry.breakProfile,
      updatedAt: now,
      updatedBy: "AMG hours cleanup"
    };
    delete next.importedHours;
    const result = await upsertCloudEntry(next);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error, clearedSoFar: cleared }, { status: 502 });
    }
    cleared.push({
      date: entry.date,
      employeeId: entry.employeeId,
      hoursRemoved: entry.importedHours,
      manualHoursKept: next.manualHours
    });
  }

  return NextResponse.json({ ok: true, cleared: cleared.length, details: cleared });
}
