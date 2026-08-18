import { NextResponse } from "next/server";
import { fetchAmgHours, isAmgConfigured } from "@/lib/amgTime";
import { isCloudEntriesConfigured, readCloudEntries, upsertCloudEntry } from "@/lib/cloudEntries";
import { isCloudRosterConfigured, readCloudEmployees } from "@/lib/cloudEmployees";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Nightly automatic hours sync (Vercel Cron). Pulls the last few days of
// hours from AMG and writes them onto matching entries entirely server-side.
// Matching is by the AMG code remembered on each roster record
// (timeclockCode) — people not yet matched are skipped here and get matched
// once through the Payroll screen's sync preview, which remembers the code.

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  // Vercel Cron calls carry Authorization: Bearer <CRON_SECRET>. Without the
  // secret configured the endpoint stays closed rather than open.
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!isAmgConfigured()) return NextResponse.json({ ok: false, error: "AMG credentials not configured" }, { status: 503 });
  if (!isCloudEntriesConfigured() || !isCloudRosterConfigured()) {
    return NextResponse.json({ ok: false, error: "Cloud storage not configured" }, { status: 503 });
  }

  try {
    // Cover the last 4 days so late punches and weekend edits self-heal.
    const startDate = isoDaysAgo(4);
    const endDate = isoDaysAgo(0);
    const blocks = await fetchAmgHours(startDate, endDate);

    const employees = await readCloudEmployees();
    const byCode = new Map(
      employees.filter((employee) => employee.timeclockCode).map((employee) => [employee.timeclockCode as string, employee])
    );
    const nameById = new Map(employees.map((employee) => [employee.id, normalizeName(employee.name)]));

    const entries = (await readCloudEntries()).filter(
      (entry) => !entry.deleted && entry.date >= startDate && entry.date <= endDate
    );

    let applied = 0;
    let unmatchedCodes = 0;
    const now = new Date().toISOString();
    for (const block of blocks) {
      const employee = byCode.get(block.code);
      if (!employee) {
        unmatchedCodes++;
        continue;
      }
      const targetName = normalizeName(employee.name);
      for (const day of block.days) {
        if (day.hours <= 0) continue;
        const dayEntries = entries.filter(
          (entry) => entry.date === day.date && (nameById.get(entry.employeeId) ?? normalizeName(entry.employeeId)) === targetName
        );
        for (const entry of dayEntries) {
          // Unchanged hours are left alone so clients aren't poked to re-pull.
          if (entry.importedHours === day.hours) continue;
          await upsertCloudEntry({
            ...entry,
            manualHours: day.hours,
            importedHours: day.hours,
            breakProfile: "noLunch",
            updatedAt: now,
            updatedBy: "AMG hours sync"
          });
          applied++;
        }
      }
    }

    return NextResponse.json({ ok: true, range: { startDate, endDate }, people: blocks.length, applied, unmatchedCodes });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "AMG cron sync failed." },
      { status: 502 }
    );
  }
}
