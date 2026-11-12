import { NextResponse } from "next/server";
import { getFleetStatus } from "@/lib/fleetCache";
import { allowCall } from "@/lib/rateLimit";
import { isSamsaraConfigured } from "@/lib/samsara";
import { getSupabaseServerClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The yard alert's every-minute check, so its 30-minute timers run even when
// nobody has the site open. Called once a minute by a Supabase scheduled job
// (pg_cron + pg_net — see docs/samsara-fleet-notes.md). It only refreshes the
// timers and answers "ok": no truck, trailer or yard data is returned, so it
// needs no sign-in. Repeated calls reuse the same 30-second Samsara pull.
export async function GET() {
  if (!isSamsaraConfigured()) return NextResponse.json({ ok: false, error: "Samsara not configured" }, { status: 503 });
  if (!allowCall("yard-watch", 20, 60_000)) return NextResponse.json({ ok: false, error: "Too many checks" }, { status: 429 });
  try {
    const status = await getFleetStatus(getSupabaseServerClient());
    return NextResponse.json({ ok: Boolean(status.yardWatch), checkedAt: status.yardWatch?.checkedAt ?? null });
  } catch {
    return NextResponse.json({ ok: false, error: "Samsara lookup failed" }, { status: 502 });
  }
}
