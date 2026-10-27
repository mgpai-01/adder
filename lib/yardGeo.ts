// Where each yard is on the map — looked up from its address with TomTom's
// geocoder and cached per server instance, so lib/yards stays the one place
// to change a yard. Server-only (needs TOMTOM_API_KEY).
import type { Yard } from "./yards";

const positions = new Map<string, { lat: number; lon: number }>();

export async function yardPosition(yard: Yard, key: string): Promise<{ lat: number; lon: number }> {
  const cached = positions.get(yard.id);
  if (cached) return cached;
  const response = await fetch(
    `https://api.tomtom.com/search/2/geocode/${encodeURIComponent(yard.address)}.json?key=${encodeURIComponent(key)}&limit=1&countrySet=US`,
    { cache: "no-store" }
  );
  if (!response.ok) throw new Error(`Couldn't find the yard's address (${response.status})`);
  const body = (await response.json()) as { results?: Array<{ position?: { lat?: number; lon?: number } }> };
  const position = body.results?.[0]?.position;
  if (typeof position?.lat !== "number" || typeof position?.lon !== "number") throw new Error("Couldn't find the yard's address");
  const result = { lat: position.lat, lon: position.lon };
  positions.set(yard.id, result);
  return result;
}
