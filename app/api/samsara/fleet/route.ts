import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/apiAuth";
import { canSeeSamsaraPreview } from "@/lib/previewAccess";
import { fetchFleetSnapshot, isSamsaraConfigured, type FleetSnapshot } from "@/lib/samsara";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The map refreshes every minute; anyone opening it within this window shares
// one Samsara pull instead of each sending their own.
const CACHE_MS = 30_000;
let cached: { at: number; snapshot: FleetSnapshot } | null = null;

// Where every truck, trailer and tracked piece of equipment is right now, from
// Samsara. Preview: only the logins in lib/previewAccess may call it — checked
// here on the server, so hiding the button isn't the only lock.
export async function GET(request: Request) {
  const check = await requireCaller(request);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const { data } = await check.supabase.auth.admin.getUserById(check.userId);
  if (!canSeeSamsaraPreview(data.user?.email)) {
    return NextResponse.json({ error: "Not available for this account yet" }, { status: 403 });
  }
  if (!isSamsaraConfigured()) {
    return NextResponse.json({ error: "SAMSARA_API_TOKEN is not set in Vercel" }, { status: 503 });
  }

  try {
    if (!cached || Date.now() - cached.at > CACHE_MS) {
      cached = { at: Date.now(), snapshot: await fetchFleetSnapshot() };
    }
    return NextResponse.json({ ok: true, ...cached.snapshot });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Samsara lookup failed" }, { status: 502 });
  }
}
