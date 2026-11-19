// Which yard / place a unit is at. Samsara decides when it can: its GPS can
// say which Samsara address (geofence) the unit is inside (FleetItem
// .samsaraPlace), and that answer is used. Only when the feed a fix came from
// doesn't say does the unit's point get checked against the geofence shape.
//
// A unit counts at an area when Samsara puts it in that area's own geofence,
// or in another Samsara address that sits inside the area (e.g. "Main Yard"
// drawn inside the Sultana yard) — Samsara names only one when they overlap.
// If Samsara says the unit is in no address at all, it isn't at any area.
// Shared by the map, the Yard board, the Fleet sections and the yard alert,
// so they always agree.
import { insideGeofence, type Geofence } from "./geo";
import type { FleetItem } from "./samsara";

export type MatchArea = Geofence & { placeId?: string };
// Samsara place id → its center, to place a smaller address inside an area.
export type PlaceCenters = Map<string, { lat: number; lng: number }>;

export function isAt(item: FleetItem, area: MatchArea, centers: PlaceCenters, fallbackMeters: number): boolean {
  const place = item.samsaraPlace;
  if (place === undefined || !area.placeId) return insideGeofence(area, item.lat, item.lng, fallbackMeters);
  if (place === null) return false;
  if (place.id === area.placeId) return true;
  const center = centers.get(place.id);
  if (center && insideGeofence(area, center.lat, center.lng, fallbackMeters)) return true;
  // Samsara named some other address — e.g. a big area drawn around several
  // yards, picked over this one where they overlap: fall back to the shape.
  return insideGeofence(area, item.lat, item.lng, fallbackMeters);
}

export function placeCenters(places: Array<{ id: string; lat: number; lng: number }>): PlaceCenters {
  return new Map(places.map((place) => [place.id, { lat: place.lat, lng: place.lng }]));
}
