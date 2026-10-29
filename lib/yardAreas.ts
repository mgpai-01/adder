// Server-only: MGP's yards (lib/yards) as areas on the map — each yard's
// spot plus the Samsara geofence that counts as "at the yard". Shared by the
// Yard board (/api/samsara/yards) and the ETAs (/api/samsara/eta) so both
// always agree on where a yard is. Cached 10 minutes.
import { insideGeofence, metersBetween } from "./geo";
import { fetchPlaces, type FleetPlace } from "./samsara";
import { yardPosition } from "./yardGeo";
import { YARDS, type Yard, type YardArea } from "./yards";

const CACHE_MS = 10 * 60_000;
const MATCH_METERS = 400;
const DEFAULT_RADIUS = 250;
let cached: { at: number; yards: YardArea[]; warnings: string[] } | null = null;

// "FedEx #26" matches "FEDEX #26", "Fedex 26", "FedEx#26 yard".
const squash = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

function placeNear(places: FleetPlace[], lat: number, lng: number): FleetPlace | null {
  const containing = places.find((place) => insideGeofence(place, lat, lng, 0));
  if (containing) return containing;
  const nearest = places
    .map((place) => ({ place, meters: metersBetween(place.lat, place.lng, lat, lng) }))
    .filter((row) => row.meters <= MATCH_METERS)
    .sort((a, b) => a.meters - b.meters)[0];
  return nearest?.place ?? null;
}

function fromPlace(yard: Yard, place: FleetPlace): YardArea {
  return {
    id: yard.id,
    name: yard.name,
    address: yard.address || place.address,
    lat: place.lat,
    lng: place.lng,
    radiusMeters: place.radiusMeters ?? (place.polygon ? null : DEFAULT_RADIUS),
    polygon: place.polygon,
    placeName: place.name,
    placeId: place.id
  };
}

async function build(key: string): Promise<{ yards: YardArea[]; warnings: string[] }> {
  const warnings: string[] = [];
  let places: FleetPlace[] = [];
  try {
    places = await fetchPlaces();
  } catch (error) {
    warnings.push(`Samsara geofences didn't load, so address yards are ${DEFAULT_RADIUS} m circles: ${error instanceof Error ? error.message : "failed"}`);
  }
  const yards: YardArea[] = [];
  for (const yard of YARDS) {
    try {
      if (yard.samsaraPlace) {
        // Best match wins: the exact name, then a name that starts with it,
        // then one that contains it — never just the first alphabetically.
        const wanted = squash(yard.samsaraPlace);
        const place =
          places.find((item) => squash(item.name) === wanted) ??
          places.find((item) => squash(item.name).startsWith(wanted)) ??
          places.find((item) => squash(item.name).includes(wanted));
        if (!place) {
          warnings.push(`${yard.name}: no Samsara place named "${yard.samsaraPlace}" was found, so it isn't on the board.`);
          continue;
        }
        yards.push(fromPlace(yard, place));
        continue;
      }
      if (!key) throw new Error("TOMTOM_API_KEY is not set in Vercel (needed to place address yards)");
      const spot = await yardPosition(yard, key);
      const place = placeNear(places, spot.lat, spot.lon);
      yards.push(
        place
          ? fromPlace(yard, place)
          : { id: yard.id, name: yard.name, address: yard.address ?? "", lat: spot.lat, lng: spot.lon, radiusMeters: DEFAULT_RADIUS, polygon: null, placeName: "", placeId: "" }
      );
    } catch (error) {
      warnings.push(`${yard.name}: ${error instanceof Error ? error.message : "couldn't be placed"}`);
    }
  }
  return { yards, warnings };
}

export async function resolveYardAreas(): Promise<{ yards: YardArea[]; warnings: string[] }> {
  if (!cached || Date.now() - cached.at > CACHE_MS) {
    cached = { at: Date.now(), ...(await build(process.env.TOMTOM_API_KEY ?? "")) };
  }
  return { yards: cached.yards, warnings: cached.warnings };
}
