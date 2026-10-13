// Server-side client for the Samsara API (api.samsara.com): where every truck,
// trailer and piece of tracked equipment is right now. The token lives in the
// SAMSARA_API_TOKEN environment variable (Vercel project settings) and never
// leaves the server. It is read-only: Vehicles, Assets, Trailers, Equipment.
//
// Samsara keeps trucks and other assets apart:
// - Trucks (vehicle gateways): GET /fleet/vehicles/stats?types=gps — latest GPS.
// - Trailers / equipment (asset trackers): GET /assets/location-and-speed/stream
//   over a recent window; the newest point per asset is its location. Names
//   come from GET /fleet/trailers and GET /fleet/equipment.
// Each source is fetched on its own, so one failing (a missing scope, say)
// still leaves the others on the map, with the failure listed in `warnings`.

const SAMSARA_HOST = "https://api.samsara.com";
// How far back to look for trailer/equipment pings. Parked trailers report
// rarely, so this is generous; anything older just isn't on the map.
const ASSET_LOOKBACK_HOURS = 72;
const MAX_PAGES = 25;

export type FleetKind = "truck" | "trailer" | "equipment" | "asset";

export type FleetItem = {
  id: string;
  name: string;
  kind: FleetKind;
  lat: number;
  lng: number;
  headingDegrees: number | null;
  speedMph: number | null;
  address: string;
  time: string;
};

export type FleetSnapshot = { items: FleetItem[]; warnings: string[]; fetchedAt: string };

export function isSamsaraConfigured(): boolean {
  return Boolean(process.env.SAMSARA_API_TOKEN);
}

type Page<T> = { data?: T[]; pagination?: { endCursor?: string; hasNextPage?: boolean } };

async function samsaraGet<T>(path: string, params: Record<string, string> = {}): Promise<T[]> {
  const rows: T[] = [];
  let after = "";
  for (let page = 0; page < MAX_PAGES; page++) {
    const query = new URLSearchParams({ ...params, ...(after ? { after } : {}) });
    const response = await fetch(`${SAMSARA_HOST}${path}?${query}`, {
      headers: { Authorization: `Bearer ${process.env.SAMSARA_API_TOKEN ?? ""}`, Accept: "application/json" },
      cache: "no-store"
    });
    if (!response.ok) {
      const hint =
        response.status === 401
          ? "the token was rejected — check SAMSARA_API_TOKEN"
          : response.status === 403
            ? "the token is missing a read permission for this"
            : `HTTP ${response.status}`;
      throw new Error(`${path}: ${hint}`);
    }
    const body = (await response.json()) as Page<T>;
    rows.push(...(body.data ?? []));
    if (!body.pagination?.hasNextPage || !body.pagination.endCursor) break;
    after = body.pagination.endCursor;
  }
  return rows;
}

const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const str = (value: unknown): string => (typeof value === "string" ? value : "");

type VehicleStat = {
  id?: string;
  name?: string;
  gps?: {
    time?: string;
    latitude?: number;
    longitude?: number;
    headingDegrees?: number;
    speedMilesPerHour?: number;
    reverseGeo?: { formattedLocation?: string };
  };
};

async function fetchTrucks(): Promise<FleetItem[]> {
  const rows = await samsaraGet<VehicleStat>("/fleet/vehicles/stats", { types: "gps" });
  const items: FleetItem[] = [];
  for (const row of rows) {
    const lat = num(row.gps?.latitude);
    const lng = num(row.gps?.longitude);
    if (!row.id || lat === null || lng === null) continue;
    items.push({
      id: row.id,
      name: str(row.name) || `Truck ${row.id}`,
      kind: "truck",
      lat,
      lng,
      headingDegrees: num(row.gps?.headingDegrees),
      speedMph: num(row.gps?.speedMilesPerHour),
      address: str(row.gps?.reverseGeo?.formattedLocation),
      time: str(row.gps?.time)
    });
  }
  return items;
}

type Named = { id?: string; name?: string };

type AssetPoint = {
  asset?: { id?: string };
  happenedAtTime?: string;
  location?: {
    latitude?: number;
    longitude?: number;
    headingDegrees?: number;
    address?: { formattedAddress?: string; formattedLocation?: string } | string;
  };
  speed?: { gpsSpeedMetersPerSecond?: number; ecuSpeedMetersPerSecond?: number };
};

// Newest point per asset from the location stream.
async function fetchAssetPoints(): Promise<Map<string, AssetPoint>> {
  const start = new Date(Date.now() - ASSET_LOOKBACK_HOURS * 3600_000).toISOString();
  const rows = await samsaraGet<AssetPoint>("/assets/location-and-speed/stream", {
    startTime: start,
    endTime: new Date().toISOString(),
    includeReverseGeo: "true",
    includeSpeed: "true",
    limit: "512"
  });
  const latest = new Map<string, AssetPoint>();
  for (const row of rows) {
    const id = row.asset?.id;
    if (!id) continue;
    const current = latest.get(id);
    if (!current || str(row.happenedAtTime) > str(current.happenedAtTime)) latest.set(id, row);
  }
  return latest;
}

export async function fetchFleetSnapshot(): Promise<FleetSnapshot> {
  const warnings: string[] = [];
  const settle = async <T,>(label: string, work: Promise<T>, fallback: T): Promise<T> => {
    try {
      return await work;
    } catch (error) {
      warnings.push(`${label}: ${error instanceof Error ? error.message : "failed"}`);
      return fallback;
    }
  };

  const [trucks, trailers, equipment, points] = await Promise.all([
    settle("Trucks", fetchTrucks(), [] as FleetItem[]),
    settle("Trailer names", samsaraGet<Named>("/fleet/trailers", { limit: "512" }), [] as Named[]),
    settle("Equipment names", samsaraGet<Named>("/fleet/equipment", { limit: "512" }), [] as Named[]),
    settle("Trailer & equipment locations", fetchAssetPoints(), new Map<string, AssetPoint>())
  ]);

  const truckIds = new Set(trucks.map((item) => item.id));
  const trailerNames = new Map(trailers.filter((row) => row.id).map((row) => [row.id as string, str(row.name)]));
  const equipmentNames = new Map(equipment.filter((row) => row.id).map((row) => [row.id as string, str(row.name)]));

  const assets: FleetItem[] = [];
  for (const [id, point] of points) {
    // Trucks show up in the stream too; their vehicle stats are the better source.
    if (truckIds.has(id)) continue;
    const lat = num(point.location?.latitude);
    const lng = num(point.location?.longitude);
    if (lat === null || lng === null) continue;
    const kind: FleetKind = trailerNames.has(id) ? "trailer" : equipmentNames.has(id) ? "equipment" : "asset";
    const name = trailerNames.get(id) || equipmentNames.get(id) || "";
    const address = point.location?.address;
    const metersPerSecond = num(point.speed?.gpsSpeedMetersPerSecond) ?? num(point.speed?.ecuSpeedMetersPerSecond);
    assets.push({
      id,
      name: name || `${kind === "trailer" ? "Trailer" : kind === "equipment" ? "Equipment" : "Asset"} ${id}`,
      kind,
      lat,
      lng,
      headingDegrees: num(point.location?.headingDegrees),
      speedMph: metersPerSecond === null ? null : Math.round(metersPerSecond * 2.23694),
      address: typeof address === "string" ? address : str(address?.formattedAddress) || str(address?.formattedLocation),
      time: str(point.happenedAtTime)
    });
  }

  const items = [...trucks, ...assets].sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  return { items, warnings, fetchedAt: new Date().toISOString() };
}
