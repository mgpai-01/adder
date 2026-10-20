// Server-side client for the Samsara API (api.samsara.com): where every truck,
// trailer and piece of tracked equipment is right now. The token lives in the
// SAMSARA_API_TOKEN environment variable (Vercel project settings) and never
// leaves the server. It is read-only: Vehicles, Assets, Trailers, Equipment.
//
// Samsara keeps trucks and other assets apart:
// - Trucks (vehicle gateways): GET /fleet/vehicles/stats?types=gps — latest GPS.
// - Trailers: GET /fleet/trailers/stats?types=gps — latest GPS, same as trucks.
// - Anything else (equipment): GET /assets/location-and-speed/stream
//   over a recent window; the newest point per asset is its location. Names
//   come from GET /fleet/trailers and GET /fleet/equipment.
// Each source is fetched on its own, so one failing (a missing scope, say)
// still leaves the others on the map, with the failure listed in `warnings`.

const SAMSARA_HOST = "https://api.samsara.com";
// How far back to look for trailer/equipment pings. Parked trailers report
// rarely, so this is generous; anything older just isn't on the map.
const ASSET_LOOKBACK_HOURS = 72;
const MAX_PAGES = 25;

export type FleetKind = "truck" | "trailer" | "yard" | "equipment" | "asset";

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
  // Trailer length read from the name ("53 ft"), or "" when it doesn't say.
  size: string;
};

export type FleetSnapshot = { items: FleetItem[]; warnings: string[]; fetchedAt: string };

// Samsara files many trailers as generic "assets" (unpowered trackers), so
// the name decides: "228MGP- box (53Feet)", "100MGP-TR- 45 foot", "Larch Yard".
const TRAILER_NAME = /\b(box|trailer|reefer|flatbed|dry\s*van|chassis|fruehauf|wabash|utility|great\s*dane|hyundai|stoughton)\b|(^|[\s-])tr([\s-]|$)|\d{2}\s*(?:'|ft\b|foot|feet)/i;
const YARD_NAME = /\byard\b/i;

function classify(name: string, kind: FleetKind): FleetKind {
  if (kind === "truck") return kind;
  if (YARD_NAME.test(name)) return "yard";
  if (kind === "asset" && TRAILER_NAME.test(name)) return "trailer";
  return kind;
}

function trailerSize(name: string): string {
  const match = /(\d{2})\s*(?:'|ft\b|foot|feet)/i.exec(name);
  return match ? `${match[1]} ft` : "";
}

export function isSamsaraConfigured(): boolean {
  return Boolean(process.env.SAMSARA_API_TOKEN);
}

type Page<T> = { data?: T[]; pagination?: { endCursor?: string; hasNextPage?: boolean } };

// Samsara's own message for a failed call (it says which parameter it
// rejected), with a plain-words hint for the common cases.
async function describeFailure(response: Response): Promise<string> {
  let message = "";
  try {
    const body = (await response.json()) as { message?: string; error?: string };
    message = (body.message || body.error || "").slice(0, 200);
  } catch {
    // not JSON
  }
  const hint =
    response.status === 401
      ? "the token was rejected — check SAMSARA_API_TOKEN"
      : response.status === 403
        ? "the token is missing a read permission for this"
        : `HTTP ${response.status}`;
  return message ? `${hint} — ${message}` : hint;
}

async function samsaraRaw<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const response = await fetch(`${SAMSARA_HOST}${path}?${new URLSearchParams(params)}`, {
    headers: { Authorization: `Bearer ${process.env.SAMSARA_API_TOKEN ?? ""}`, Accept: "application/json" },
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`${path}: ${await describeFailure(response)}`);
  return (await response.json()) as T;
}

async function samsaraGet<T>(path: string, params: Record<string, string> = {}): Promise<T[]> {
  const rows: T[] = [];
  let after = "";
  for (let page = 0; page < MAX_PAGES; page++) {
    const query = new URLSearchParams({ ...params, ...(after ? { after } : {}) });
    const response = await fetch(`${SAMSARA_HOST}${path}?${query}`, {
      headers: { Authorization: `Bearer ${process.env.SAMSARA_API_TOKEN ?? ""}`, Accept: "application/json" },
      cache: "no-store"
    });
    if (!response.ok) throw new Error(`${path}: ${await describeFailure(response)}`);
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

// Latest GPS for trucks (/fleet/vehicles/stats) or trailers
// (/fleet/trailers/stats, "Read Trailer Statistics") — same shape for both.
function gpsItems(rows: VehicleStat[], kind: FleetKind, label: string): FleetItem[] {
  const items: FleetItem[] = [];
  for (const row of rows) {
    const lat = num(row.gps?.latitude);
    const lng = num(row.gps?.longitude);
    if (!row.id || lat === null || lng === null) continue;
    items.push({
      id: row.id,
      name: str(row.name) || `${label} ${row.id}`,
      kind,
      lat,
      lng,
      headingDegrees: num(row.gps?.headingDegrees),
      speedMph: num(row.gps?.speedMilesPerHour),
      address: str(row.gps?.reverseGeo?.formattedLocation),
      time: str(row.gps?.time),
      size: ""
    });
  }
  return items;
}

async function fetchTrucks(): Promise<FleetItem[]> {
  return gpsItems(await samsaraGet<VehicleStat>("/fleet/vehicles/stats", { types: "gps" }), "truck", "Truck");
}

// Trailer stats is still under /beta on some accounts; try the main path first.
async function fetchTrailers(): Promise<FleetItem[]> {
  try {
    return gpsItems(await samsaraGet<VehicleStat>("/fleet/trailers/stats", { types: "gps" }), "trailer", "Trailer");
  } catch (error) {
    if (!(error instanceof Error) || !/HTTP 404/.test(error.message)) throw error;
    return gpsItems(await samsaraGet<VehicleStat>("/beta/fleet/trailers/stats", { types: "gps" }), "trailer", "Trailer");
  }
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

// RFC 3339 without milliseconds — some Samsara endpoints reject the ".123".
const rfc3339 = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

function newestPerAsset(rows: AssetPoint[]): Map<string, AssetPoint> {
  const latest = new Map<string, AssetPoint>();
  for (const row of rows) {
    const id = row.asset?.id;
    if (!id) continue;
    const current = latest.get(id);
    if (!current || str(row.happenedAtTime) > str(current.happenedAtTime)) latest.set(id, row);
  }
  return latest;
}

type LegacyAsset = {
  id?: number | string;
  name?: string;
  location?: Array<{ latitude?: number; longitude?: number; location?: string; speedMilesPerHour?: number; timeMs?: number }>;
};

type EquipmentLocation = {
  id?: string;
  name?: string;
  location?: { latitude?: number; longitude?: number; heading?: number; speed?: number; time?: string; reverseGeo?: { formattedLocation?: string } };
};

// Newest location per trailer / piece of equipment. Tries the asset location
// stream first (a few parameter sets, simplest last), then Samsara's older
// "current asset locations" call, then the equipment snapshot — whichever
// answers first wins. Names found along the way are returned too.
async function fetchAssetPoints(): Promise<{ points: Map<string, AssetPoint>; names: Map<string, string>; note: string }> {
  const now = Date.now();
  const start = rfc3339(now - ASSET_LOOKBACK_HOURS * 3600_000);
  const attempts: Array<Record<string, string>> = [
    { startTime: start, endTime: rfc3339(now), includeReverseGeo: "true", includeSpeed: "true" },
    { startTime: start, endTime: rfc3339(now) },
    { startTime: rfc3339(now - 24 * 3600_000) }
  ];
  const failures: string[] = [];
  for (const params of attempts) {
    try {
      const rows = await samsaraGet<AssetPoint>("/assets/location-and-speed/stream", params);
      return { points: newestPerAsset(rows), names: new Map(), note: "" };
    } catch (error) {
      failures.push(error instanceof Error ? error.message : "failed");
    }
  }

  try {
    const body = await samsaraRaw<{ assets?: LegacyAsset[] }>("/v1/fleet/assets/locations");
    const points = new Map<string, AssetPoint>();
    const names = new Map<string, string>();
    for (const asset of body.assets ?? []) {
      const id = asset.id === undefined ? "" : String(asset.id);
      const fix = [...(asset.location ?? [])].sort((a, b) => (b.timeMs ?? 0) - (a.timeMs ?? 0))[0];
      if (!id || !fix) continue;
      if (asset.name) names.set(id, asset.name);
      points.set(id, {
        asset: { id },
        happenedAtTime: fix.timeMs ? new Date(fix.timeMs).toISOString() : "",
        location: { latitude: fix.latitude, longitude: fix.longitude, address: fix.location ?? "" },
        speed: fix.speedMilesPerHour === undefined ? undefined : { gpsSpeedMetersPerSecond: fix.speedMilesPerHour / 2.23694 }
      });
    }
    return { points, names, note: `Using Samsara's older asset locations (the newer call said: ${failures[0]})` };
  } catch (error) {
    failures.push(error instanceof Error ? error.message : "failed");
  }

  try {
    const rows = await samsaraGet<EquipmentLocation>("/fleet/equipment/locations");
    const points = new Map<string, AssetPoint>();
    const names = new Map<string, string>();
    for (const row of rows) {
      if (!row.id || !row.location) continue;
      if (row.name) names.set(row.id, row.name);
      points.set(row.id, {
        asset: { id: row.id },
        happenedAtTime: row.location.time,
        location: { latitude: row.location.latitude, longitude: row.location.longitude, headingDegrees: row.location.heading, address: row.location.reverseGeo?.formattedLocation ?? "" },
        speed: row.location.speed === undefined ? undefined : { gpsSpeedMetersPerSecond: row.location.speed / 2.23694 }
      });
    }
    return { points, names, note: `Showing equipment only (trailer calls said: ${failures[0]})` };
  } catch (error) {
    failures.push(error instanceof Error ? error.message : "failed");
  }

  throw new Error(failures.join(" | "));
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

  const [trucks, gpsTrailers, trailers, equipment, located] = await Promise.all([
    settle("Trucks", fetchTrucks(), [] as FleetItem[]),
    settle("Trailers", fetchTrailers(), [] as FleetItem[]),
    settle("Trailer names", samsaraGet<Named>("/fleet/trailers", { limit: "512" }), [] as Named[]),
    settle("Equipment names", samsaraGet<Named>("/fleet/equipment", { limit: "512" }), [] as Named[]),
    settle("Other asset locations", fetchAssetPoints(), { points: new Map<string, AssetPoint>(), names: new Map<string, string>(), note: "" })
  ]);
  const { points, names: pointNames, note } = located;
  if (note) warnings.push(note);

  // Trucks and trailers already placed from their own GPS stats; the asset
  // stream only fills in what's left (equipment, or trailers if that failed).
  const truckIds = new Set([...trucks, ...gpsTrailers].map((item) => item.id));
  const trailerNames = new Map(trailers.filter((row) => row.id).map((row) => [row.id as string, str(row.name)]));
  const equipmentNames = new Map(equipment.filter((row) => row.id).map((row) => [row.id as string, str(row.name)]));

  const assets: FleetItem[] = [];
  for (const [id, point] of points) {
    // Already placed from vehicle / trailer stats, the better source.
    if (truckIds.has(id)) continue;
    const lat = num(point.location?.latitude);
    const lng = num(point.location?.longitude);
    if (lat === null || lng === null) continue;
    const kind: FleetKind = trailerNames.has(id) ? "trailer" : equipmentNames.has(id) ? "equipment" : "asset";
    const name = trailerNames.get(id) || equipmentNames.get(id) || pointNames.get(id) || "";
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
      time: str(point.happenedAtTime),
      size: ""
    });
  }

  // Trailers Samsara knows about but that haven't reported a location.
  const locatedIds = new Set([...assets, ...gpsTrailers].map((item) => item.id));
  const silent = Array.from(trailerNames.keys()).filter((id) => !locatedIds.has(id)).length;
  if (silent > 0 && (points.size > 0 || gpsTrailers.length > 0)) warnings.push(`${silent} trailer(s) in Samsara haven't reported a location in the last ${ASSET_LOOKBACK_HOURS} hours`);

  const items = [...trucks, ...gpsTrailers, ...assets]
    .map((item) => {
      const kind = classify(item.name, item.kind);
      return { ...item, kind, size: kind === "trailer" ? trailerSize(item.name) : "" };
    }).sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  return { items, warnings, fetchedAt: new Date().toISOString() };
}
