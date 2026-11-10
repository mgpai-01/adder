import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/apiAuth";
import { canSeeSamsaraPreview } from "@/lib/previewAccess";
import type { YardArea, YardEta } from "@/lib/yards";
import { resolveYardAreas } from "@/lib/yardAreas";
import { allowCall } from "@/lib/rateLimit";

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

// Turns a typed address into a spot to route to (TomTom geocoding, US only).
async function geocode(address: string, key: string): Promise<{ lat: number; lng: number; label: string } | null> {
  const params = new URLSearchParams({ key, limit: "1", countrySet: "US" });
  const response = await fetch(`${TOMTOM}/search/2/geocode/${encodeURIComponent(address)}.json?${params}`, { cache: "no-store" });
  if (!response.ok) return null;
  const body = (await response.json()) as {
    results?: Array<{ position?: { lat?: number; lon?: number }; address?: { freeformAddress?: string } }>;
  };
  const hit = body.results?.[0];
  if (typeof hit?.position?.lat !== "number" || typeof hit.position.lon !== "number") return null;
  return { lat: hit.position.lat, lng: hit.position.lon, label: hit.address?.freeformAddress || address };
}

export async function GET(request: Request) {
  const check = await requireCaller(request);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const { data } = await check.supabase.auth.admin.getUserById(check.userId);
  if (!canSeeSamsaraPreview(data.user?.email, check.role)) {
    return NextResponse.json({ error: "Not available for this account yet" }, { status: 403 });
  }
  const key = process.env.TOMTOM_API_KEY ?? "";
  if (!key) return NextResponse.json({ error: "TOMTOM_API_KEY is not set in Vercel" }, { status: 503 });
  // Each ETA is several paid TomTom lookups: plenty for real use, but a
  // stuck script can't run up the bill.
  if (!allowCall(`eta:${check.userId}`, 40, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many drive-time checks in a short time — try again in a few minutes." }, { status: 429 });
  }

  const url = new URL(request.url);
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return NextResponse.json({ error: "Expected lat and lng" }, { status: 400 });
  }

  // A typed address instead of the yards.
  const to = (url.searchParams.get("to") ?? "").trim().slice(0, 200);
  if (to) {
    const spot = await geocode(to, key).catch(() => null);
    if (!spot) return NextResponse.json({ error: `Couldn't find “${to}”. Try adding the city or ZIP.` }, { status: 404 });
    const area: YardArea = {
      id: `address:${spot.lat.toFixed(5)},${spot.lng.toFixed(5)}`,
      name: spot.label,
      address: spot.label,
      lat: spot.lat,
      lng: spot.lng,
      radiusMeters: null,
      polygon: null,
      placeName: "",
      placeId: ""
    };
    const eta = await etaTo(area, { lat, lng }, key);
    return NextResponse.json({ ok: true, etas: [eta], at: new Date().toISOString() });
  }

  const { yards } = await resolveYardAreas();
  const etas = await Promise.all(yards.map((yard) => etaTo(yard, { lat, lng }, key)));
  etas.sort((a, b) => (a.minutes ?? Number.MAX_SAFE_INTEGER) - (b.minutes ?? Number.MAX_SAFE_INTEGER));
  return NextResponse.json({ ok: true, etas, at: new Date().toISOString() });
}
