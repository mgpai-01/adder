import { NextResponse } from "next/server";
import { isCloudEntriesConfigured, readCloudEntriesFingerprint } from "@/lib/cloudEntries";

export const dynamic = "force-dynamic";

// Cheap change-detector: returns a small fingerprint of the entries table so
// clients can poll often and only pull the full (photo-heavy) entries when it
// changes — keeps cross-user updates near-instant with minimal egress.
export async function GET() {
  if (isCloudEntriesConfigured()) {
    return NextResponse.json({ fingerprint: await readCloudEntriesFingerprint() });
  }
  return NextResponse.json({ fingerprint: "local" });
}
