import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/apiAuth";
import { canSeeSamsaraPreview } from "@/lib/previewAccess";
import { fetchPlaces, isSamsaraConfigured, type FleetPlace } from "@/lib/samsara";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The places (addresses / geofences) marked in Samsara, for the fleet map.
// They rarely change, so one pull is shared for 10 minutes. Same preview lock
// as the rest of the fleet map.
const CACHE_MS = 10 * 60_000;
let cached: { at: number; places: FleetPlace[] } | null = null;

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
    if (!cached || Date.now() - cached.at > CACHE_MS) cached = { at: Date.now(), places: await fetchPlaces() };
    return NextResponse.json({ ok: true, places: cached.places });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Samsara lookup failed";
    // Most likely cause: the token doesn't have Addresses → Read yet.
    const missingScope = /missing a read permission|HTTP 403/.test(message);
    return NextResponse.json(
      {
        error: missingScope
          ? "Samsara places need the token's Addresses → Read permission (Samsara → Settings → API Tokens)."
          : message
      },
      { status: missingScope ? 403 : 502 }
    );
  }
}
