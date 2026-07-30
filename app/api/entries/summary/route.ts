import { NextResponse } from "next/server";
import { isCloudEntriesConfigured, readCloudEntriesSummary } from "@/lib/cloudEntries";
import { readLocalEntries } from "@/lib/localEntries";

export const dynamic = "force-dynamic";

// Photo-free entry list for read-only displays (the live board). Returns only
// the fields needed to total pallets, so the heavy embedded photos are never
// transferred — the main lever for keeping Supabase egress down.
export async function GET() {
  if (isCloudEntriesConfigured()) {
    const entries = await readCloudEntriesSummary();
    return NextResponse.json({ entries, storage: "cloud" });
  }

  // This endpoint is readable by the public board, so the local fallback must
  // strip to the same shape the cloud summary returns — hours, clock times,
  // notes and submitter never leave the server here.
  const entries = (await readLocalEntries()).map((entry) => ({
    id: entry.id,
    date: entry.date,
    employeeId: entry.employeeId,
    locationId: entry.locationId,
    shift: entry.shift,
    lines: entry.lines ?? [],
    createdAt: entry.createdAt
  }));
  return NextResponse.json({ entries, storage: "local" });
}
