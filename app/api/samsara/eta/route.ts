import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/apiAuth";
import { canSeeSamsaraPreview } from "@/lib/previewAccess";
import type { YardArea, YardEta } from "@/lib/yards";
import { resolveYardAreas } from "@/lib/yardAreas";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Drive time from a truck/trailer to each yard with live traffic, in truck
// mode (TomTom Routing API). GET ?lat=..&lng=.. → one result per yard.
// Same preview lock as the fleet map.

const TOMTOM = "https://api.tomtom.com";

// Routes to the yard's spot — the same one the Yard board uses
// (lib/yardAreas), so a yard is never in two places.
async function etaTo(yard: YardArea, from: { lat: number; lng: number }, key: string): Promise<YardEta> {
  const base = { yardId: yard.id, name: yard.name, address: yard.address };
  try {
    const to = { lat: yard.lat, lon: yard.lng };
    const params = new URLSearchParams({ key, traffic: "true", travelMode: "truck", routeType: "fastest", departAt: "now" });
    const response = await fetch(`${TOMTOM}/routing/1/calculateRoute/${from.lat},${from.lng}:${to.lat},${to.lon}/json?${params}`, {
      cache: "no-store"
    });
    if (!response.ok) {
      const detail = (await response.json().catch(() => null)) as { error?: { description?: string } } | null;
      throw new Error(detail?.error?.description || `TomTom routing failed (${response.status})`);
    }
    const body = (await response.json()) as {
      routes?: Array<{
        summary?: { lengthInMeters?: number; travelTimeInSeconds?: number; trafficDelayInSeconds?: number; arrivalTime?: string };
        legs?: Array<{ points?: Array<{ latitude?: number; longitude?: number }> }>;
      }>;
    };
    const summary = body.routes?.[0]?.summary;
    const points = (body.routes?.[0]?.legs ?? [])
      .flatMap((leg) => leg.points ?? [])
      .filter((point) => typeof point.latitude === "number" && typeof point.longitude === "number")
      .map((point) => [point.latitude as number, point.longitude as number] as [number, number]);
    // Keep the line light: at most ~400 points, always including both ends.
    const step = Math.max(1, Math.ceil(points.length / 400));
    const path = points.filter((_, index) => index % step === 0 || index === points.length - 1);
    if (!summary || typeof summary.travelTimeInSeconds !== "number") throw new Error("No route found");
    return {
      ...base,
      minutes: Math.round(summary.travelTimeInSeconds / 60),
      miles: Math.round(((summary.lengthInMeters ?? 0) / 1609.344) * 10) / 10,
      trafficDelayMinutes: Math.round((summary.trafficDelayInSeconds ?? 0) / 60),
      arrival: summary.arrivalTime,
      path,
      yardLat: to.lat,
      yardLng: to.lon
    };
  } catch (error) {
    return { ...base, error: error instanceof Error ? error.message : "Couldn't get a route" };
  }
}

export async function GET(request: Request) {
  const check = await requireCaller(request);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const { data } = await check.supabase.auth.admin.getUserById(check.userId);
  if (!canSeeSamsaraPreview(data.user?.email)) {
    return NextResponse.json({ error: "Not available for this account yet" }, { status: 403 });
  }
  const key = process.env.TOMTOM_API_KEY ?? "";
  if (!key) return NextResponse.json({ error: "TOMTOM_API_KEY is not set in Vercel" }, { status: 503 });

  const url = new URL(request.url);
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return NextResponse.json({ error: "Expected lat and lng" }, { status: 400 });
  }

  const { yards } = await resolveYardAreas();
  const etas = await Promise.all(yards.map((yard) => etaTo(yard, { lat, lng }, key)));
  etas.sort((a, b) => (a.minutes ?? Number.MAX_SAFE_INTEGER) - (b.minutes ?? Number.MAX_SAFE_INTEGER));
  return NextResponse.json({ ok: true, etas, at: new Date().toISOString() });
}
