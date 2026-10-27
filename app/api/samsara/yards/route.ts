import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/apiAuth";
import { insideGeofence, metersBetween } from "@/lib/geo";
import { canSeeSamsaraPreview } from "@/lib/previewAccess";
import { fetchPlaces, isSamsaraConfigured, type FleetPlace } from "@/lib/samsara";
import { yardPosition } from "@/lib/yardGeo";
import { YARDS, type YardArea } from "@/lib/yards";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// MGP's three yards as areas on the map, for the fleet map's Yard board.
// Each yard's address is geocoded, then matched to the Samsara geofence
// drawn around it (one that contains the spot, else the nearest within
// 400 m); with no match, a 250 m circle around the address counts as the
// yard. Cached 10 minutes; same preview lock as the rest of the fleet map.
const CACHE_MS = 10 * 60_000;
const MATCH_METERS = 400;
const DEFAULT_RADIUS = 250;
let cached: { at: number; yards: YardArea[]; warnings: string[] } | null = null;

function matchPlace(places: FleetPlace[], lat: number, lng: number): FleetPlace | null {
  const containing = places.find((place) => insideGeofence(place, lat, lng, 0));
  if (containing) return containing;
  const nearest = places
    .map((place) => ({ place, meters: metersBetween(place.lat, place.lng, lat, lng) }))
    .filter((row) => row.meters <= MATCH_METERS)
    .sort((a, b) => a.meters - b.meters)[0];
  return nearest?.place ?? null;
}

async function buildYards(): Promise<{ yards: YardArea[]; warnings: string[] }> {
  const key = process.env.TOMTOM_API_KEY ?? "";
  if (!key) throw new Error("TOMTOM_API_KEY is not set in Vercel (needed to place the yards)");
  const warnings: string[] = [];
  let places: FleetPlace[] = [];
  try {
    places = await fetchPlaces();
  } catch (error) {
    warnings.push(`Samsara geofences didn't load, so each yard is a ${DEFAULT_RADIUS} m circle: ${error instanceof Error ? error.message : "failed"}`);
  }
  const yards = await Promise.all(
    YARDS.map(async (yard): Promise<YardArea> => {
      const spot = await yardPosition(yard, key);
      const place = matchPlace(places, spot.lat, spot.lon);
      if (place) {
        return {
          id: yard.id,
          name: yard.name,
          address: yard.address,
          lat: place.lat,
          lng: place.lng,
          radiusMeters: place.radiusMeters ?? (place.polygon ? null : DEFAULT_RADIUS),
          polygon: place.polygon,
          placeName: place.name,
          placeId: place.id
        };
      }
      return { id: yard.id, name: yard.name, address: yard.address, lat: spot.lat, lng: spot.lon, radiusMeters: DEFAULT_RADIUS, polygon: null, placeName: "", placeId: "" };
    })
  );
  return { yards, warnings };
}

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
    if (!cached || Date.now() - cached.at > CACHE_MS) cached = { at: Date.now(), ...(await buildYards()) };
    return NextResponse.json({ ok: true, yards: cached.yards, warnings: cached.warnings });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Couldn't place the yards" }, { status: 502 });
  }
}
