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

  const entries = await readLocalEntries();
  return NextResponse.json({ entries, storage: "local" });
}
