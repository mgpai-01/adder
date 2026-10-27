// Geofence math shared by the server and the fleet map.
export type Geofence = {
  lat: number;
  lng: number;
  radiusMeters: number | null;
  polygon: Array<[number, number]> | null;
};

export function metersBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLng = (bLng - aLng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

// Inside the polygon, within the circle, or — with neither — within
// `fallbackMeters` of the center.
export function insideGeofence(fence: Geofence, lat: number, lng: number, fallbackMeters = 150): boolean {
  if (fence.polygon && fence.polygon.length >= 3) {
    let inside = false;
    const ring = fence.polygon;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [yi, xi] = ring[i];
      const [yj, xj] = ring[j];
      if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  return metersBetween(fence.lat, fence.lng, lat, lng) <= (fence.radiusMeters ?? fallbackMeters);
}
