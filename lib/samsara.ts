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
// `notes` are for things that worked another way or are simply worth knowing
// (a fallback was used, some trailers haven't reported) — not failures.

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
  // Every fix Samsara gave for this unit (each feed, and any duplicate record),
  // for the "Location sources" lines in the map popup — so a wrong-looking
  // spot can be traced to the feed it came from.
  sources?: LocationSource[];
  // Samsara's own answer to "which address (geofence) is it in": a place, or
  // null when Samsara says it's in none. Undefined when the feed this fix came
  // from doesn't say — then the map checks the geofence shape itself
  // (lib/yardMatch).
  samsaraPlace?: { id: string; name: string } | null;
};

export type LocationSource = { feed: string; time: string; lat: number; lng: number; address: string };

// A trailer Samsara knows about but has no location for at all — no spot to
// put on the map, but it belongs on the "No GPS" list. Samsara keeps a
// tracked trailer's last GPS however old it is, so these have never reported
// a location: either no tracker is paired with them ("none"), or one is but
// it has never sent a fix ("installed").
export type SilentUnit = { id: string; name: string; kind: FleetKind; size: string; tracker: "none" | "installed" | "unknown" };

// streamError: why Samsara's newer asset location stream was refused, if it
// was (the older call is used instead) — shown with the location sources.
export type FleetSnapshot = { items: FleetItem[]; silent: SilentUnit[]; warnings: string[]; notes: string[]; fetchedAt: string; streamError?: string };

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
  // Samsara answers a missing scope with 401 too, so its message decides.
  const hint = /permission/i.test(message)
    ? "the token is missing a read permission for this"
    : response.status === 401
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

// A Samsara timestamp as milliseconds (0 when missing), for "which is newer".
const when = (iso: string): number => Date.parse(iso) || 0;
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
    // The Samsara address (geofence) this fix is inside, when it's in one.
    address?: { id?: string; name?: string } | null;
  };
};

// Latest GPS for trucks (/fleet/vehicles/stats) or trailers
// (/fleet/trailers/stats, "Read Trailer Statistics") — same shape for both.
function gpsItems(rows: VehicleStat[], kind: FleetKind, label: string): FleetItem[] {
  const items: FleetItem[] = [];
  // Samsara only adds gps.address when a fix is inside one of its addresses.
  // If this feed gives it for any unit, a unit without it is "in none"; if it
  // gives it for no unit at all, the feed may simply not support it — then
  // leave it unknown and let the shape check decide.
  const feedSaysPlaces = rows.some((row) => row.gps?.address?.id);
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
      size: "",
      sources: [{ feed: `${label} GPS (stats)`, time: str(row.gps?.time), lat, lng, address: str(row.gps?.reverseGeo?.formattedLocation) }],
      samsaraPlace: row.gps?.address?.id
        ? { id: String(row.gps.address.id), name: str(row.gps.address.name) }
        : feedSaysPlaces
          ? null
          : undefined
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

// /fleet/trailers and /fleet/equipment rows. A trailer's installedGateway is
// the Samsara tracker paired with it (absent when none is installed).
type Named = { id?: string; name?: string; installedGateway?: { serial?: string; model?: string } | null };

type AssetPoint = {
  asset?: { id?: string };
  // Which call this point came from, when it differs from the rest.
  feed?: string;
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
// When the stream rejects every parameter set, don't keep asking it (and
// waiting on it) every minute — go straight to the fallbacks for an hour.
let streamSkipUntil = 0;
// Samsara's own reason from the last time the stream failed, kept through the
// pause so it isn't replaced by "paused".
let lastStreamError = "";

// The newer stream insists on a list of asset IDs ("Need to include asset IDs
// to filter by"), so it's asked about the trailers and equipment by ID, a
// few at a time to keep each answer small.
const STREAM_ID_CHUNK = 20;

async function streamPoints(ids: string[], params: Record<string, string>): Promise<Map<string, AssetPoint>> {
  const rows: AssetPoint[] = [];
  for (let index = 0; index < ids.length; index += STREAM_ID_CHUNK) {
    rows.push(...(await samsaraGet<AssetPoint>("/assets/location-and-speed/stream", { ...params, ids: ids.slice(index, index + STREAM_ID_CHUNK).join(",") })));
  }
  return newestPerAsset(rows);
}

// The older v1 call: every asset's current location in one answer.
async function legacyPoints(): Promise<{ points: Map<string, AssetPoint>; names: Map<string, string> }> {
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
  return { points, names };
}

async function fetchAssetPoints(ids: string[]): Promise<{ points: Map<string, AssetPoint>; names: Map<string, string>; note: string; feed: string; streamError: string }> {
  const now = Date.now();
  const start = rfc3339(now - ASSET_LOOKBACK_HOURS * 3600_000);
  const attempts: Array<Record<string, string>> = [
    { startTime: start, endTime: rfc3339(now), includeReverseGeo: "true", includeSpeed: "true" },
    { startTime: start, endTime: rfc3339(now) }
  ];
  const failures: string[] = [];
  for (const params of now < streamSkipUntil || ids.length === 0 ? [] : attempts) {
    try {
      const points = await streamPoints(ids, params);
      // Anything quiet for longer than the stream's window still gets its
      // last spot from the older call, so it doesn't drop off the map.
      let names = new Map<string, string>();
      try {
        const legacy = await legacyPoints();
        names = legacy.names;
        for (const [id, point] of legacy.points) if (!points.has(id)) points.set(id, { ...point, feed: "Asset locations (older v1 call)" });
      } catch {
        // the stream's answer stands on its own
      }
      lastStreamError = "";
      return { points, names, note: "", feed: "Asset location stream", streamError: "" };
    } catch (error) {
      failures.push(error instanceof Error ? error.message : "failed");
    }
  }
  if (failures.length > 0) {
    // Try the newer stream again in 10 minutes.
    streamSkipUntil = now + 10 * 60_000;
    lastStreamError = failures.join(" | ");
    // Server log (Vercel → Logs) rather than the screen: the fallbacks below
    // carry the same data, so nothing is missing for the person looking.
    console.warn(`Samsara asset stream failed; using the older call for 10 minutes: ${lastStreamError}`);
  }
  if (failures.length === 0 && now < streamSkipUntil) failures.push(lastStreamError || "the newer location call failed earlier");

  try {
    const { points, names } = await legacyPoints();
    return { points, names, note: "", feed: "Asset locations (older v1 call)", streamError: lastStreamError || failures[0] || "" };
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
    return { points, names, note: `Other assets: showing equipment only (the location calls said: ${failures[0]}).`, feed: "Equipment locations", streamError: lastStreamError || failures[0] || "" };
  } catch (error) {
    failures.push(error instanceof Error ? error.message : "failed");
  }

  throw new Error(failures.join(" | "));
}

export async function fetchFleetSnapshot(): Promise<FleetSnapshot> {
  const warnings: string[] = [];
  const notes: string[] = [];
  const settle = async <T,>(label: string, work: Promise<T>, fallback: T): Promise<T> => {
    try {
      return await work;
    } catch (error) {
      warnings.push(`${label}: ${error instanceof Error ? error.message : "failed"}`);
      return fallback;
    }
  };

  const [trucks, gpsTrailers, trailers, equipment] = await Promise.all([
    settle("Trucks", fetchTrucks(), [] as FleetItem[]),
    settle("Trailers", fetchTrailers(), [] as FleetItem[]),
    settle("Trailer names", samsaraGet<Named>("/fleet/trailers", { limit: "512" }), [] as Named[]),
    settle("Equipment names", samsaraGet<Named>("/fleet/equipment", { limit: "512" }), [] as Named[])
  ]);
  // The asset stream needs IDs: every trailer and piece of equipment Samsara listed.
  const assetIds = Array.from(new Set([...trailers, ...equipment].map((row) => row.id).filter((id): id is string => Boolean(id))));
  const located = await settle("Other asset locations", fetchAssetPoints(assetIds), {
    points: new Map<string, AssetPoint>(),
    names: new Map<string, string>(),
    note: "",
    feed: "",
    streamError: ""
  });
  const { points, names: pointNames, note, feed: assetFeed, streamError } = located;
  if (note) notes.push(note);

  // Trucks and trailers come from their own GPS stats; the asset feed fills in
  // equipment and any trailer those missed. When both feeds have the same
  // unit, the NEWER fix wins — a trailer's stats GPS can lag hours behind its
  // asset location, which put trailers where they used to be.
  const placed = new Map([...trucks, ...gpsTrailers].map((item) => [item.id, item]));
  const trailerNames = new Map(trailers.filter((row) => row.id).map((row) => [row.id as string, str(row.name)]));
  const trailerTracker = new Map(
    trailers
      .filter((row) => row.id)
      .map((row) => [row.id as string, row.installedGateway === undefined ? "unknown" : row.installedGateway?.serial ? "installed" : "none"] as const)
  );
  const equipmentNames = new Map(equipment.filter((row) => row.id).map((row) => [row.id as string, str(row.name)]));

  const assets: FleetItem[] = [];
  for (const [id, point] of points) {
    const lat = num(point.location?.latitude);
    const lng = num(point.location?.longitude);
    if (lat === null || lng === null) continue;
    const pointAddress = point.location?.address;
    const source: LocationSource = {
      feed: point.feed || assetFeed || "Asset feed",
      time: str(point.happenedAtTime),
      lat,
      lng,
      address: typeof pointAddress === "string" ? pointAddress : str(pointAddress?.formattedAddress) || str(pointAddress?.formattedLocation)
    };
    const already = placed.get(id);
    if (already) {
      already.sources = [...(already.sources ?? []), source];
      // Keep the stats fix unless this one is newer.
      if (when(str(point.happenedAtTime)) > when(already.time)) {
        const address = point.location?.address;
        const metersPerSecond = num(point.speed?.gpsSpeedMetersPerSecond) ?? num(point.speed?.ecuSpeedMetersPerSecond);
        Object.assign(already, {
          lat,
          lng,
          headingDegrees: num(point.location?.headingDegrees) ?? already.headingDegrees,
          speedMph: metersPerSecond === null ? null : Math.round(metersPerSecond * 2.23694),
          address: (typeof address === "string" ? address : str(address?.formattedAddress) || str(address?.formattedLocation)) || "",
          time: str(point.happenedAtTime),
          // That place was for the older fix; this feed doesn't say one.
          samsaraPlace: undefined
        });
      }
      continue;
    }
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
      size: "",
      sources: [source]
    });
  }

  // Trailers Samsara knows about but that haven't reported a location.
  const locatedIds = new Set([...assets, ...gpsTrailers].map((item) => item.id));
  // Only trusted when a location source answered — otherwise every trailer
  // would look silent because the lookup itself failed.
  const locationsAnswered = points.size > 0 || gpsTrailers.length > 0;
  const silent: SilentUnit[] = locationsAnswered
    ? Array.from(trailerNames.entries())
        .filter(([id]) => !locatedIds.has(id))
        .map(([id, name]) => {
          const label = name || `Trailer ${id}`;
          const kind = classify(label, "trailer");
          return { id, name: label, kind, size: kind === "trailer" ? trailerSize(label) : "", tracker: trailerTracker.get(id) ?? "unknown" };
        })
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    : [];
  if (silent.length > 0) notes.push(`${silent.length} trailer(s) in Samsara have no location on record, so they aren't on the map (see the No GPS 24h+ tab).`);

  const all = [...trucks, ...gpsTrailers, ...assets].map((item) => {
    const kind = classify(item.name, item.kind);
    return { ...item, kind, size: kind === "trailer" ? trailerSize(item.name) : "" };
  });
  // The same unit entered twice in Samsara (e.g. "212MGP-BOX…" and
  // "212MGP-TR LIC…", one with an old tracker): one pin per unit number, the
  // one with the newest GPS, so a stale record doesn't sit on the map.
  const newestByUnit = new Map<string, FleetItem>();
  const others: FleetItem[] = [];
  for (const item of all) {
    const unit = /^\s*(\d+)\s*MGP\b/i.exec(item.name)?.[1];
    if (!unit) {
      others.push(item);
      continue;
    }
    const key = `${item.kind === "truck" ? "truck" : "unit"}:${Number(unit)}`;
    const current = newestByUnit.get(key);
    const tagged = (unit: FleetItem) => (unit.sources ?? []).map((src) => ({ ...src, feed: `${src.feed} — record "${unit.name}"` }));
    if (!current) newestByUnit.set(key, item);
    else if (when(item.time) > when(current.time)) newestByUnit.set(key, { ...item, sources: [...(item.sources ?? []), ...tagged(current)] });
    else current.sources = [...(current.sources ?? []), ...tagged(item)];
  }
  const duplicates = all.length - others.length - newestByUnit.size;
  if (duplicates > 0) notes.push(`${duplicates} unit(s) are entered twice in Samsara; the map shows each once, at its newest GPS.`);
  const items = [...others, ...newestByUnit.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  // A second, never-reporting record of a unit that IS on the map isn't "no GPS".
  const onMap = new Set(Array.from(newestByUnit.keys()).filter((key) => key.startsWith("unit:")));
  const silentUnits = silent.filter((unit) => {
    const number = /^\s*(\d+)\s*MGP\b/i.exec(unit.name)?.[1];
    return !number || !onMap.has(`unit:${Number(number)}`);
  });
  return { items, silent: silentUnits, warnings, notes, fetchedAt: new Date().toISOString(), streamError };
}

// ===== Places: the addresses / geofences marked in Samsara =====
// GET /addresses (token scope: Addresses → Read). Each has a name, a
// formatted address and a geofence — a circle (center + radius) or a polygon.

export type FleetPlace = {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  radiusMeters: number | null;
  polygon: Array<[number, number]> | null;
  types: string[];
};

type AddressRow = {
  id?: string;
  name?: string;
  formattedAddress?: string;
  latitude?: number;
  longitude?: number;
  addressTypes?: string[];
  geofence?: {
    circle?: { latitude?: number; longitude?: number; radiusMeters?: number };
    polygon?: { vertices?: Array<{ latitude?: number; longitude?: number }> };
  };
};

export async function fetchPlaces(): Promise<FleetPlace[]> {
  const rows = await samsaraGet<AddressRow>("/addresses", { limit: "512" });
  const places: FleetPlace[] = [];
  for (const row of rows) {
    if (!row.id) continue;
    const circle = row.geofence?.circle;
    const vertices = (row.geofence?.polygon?.vertices ?? [])
      .map((vertex) => [num(vertex.latitude), num(vertex.longitude)])
      .filter((pair): pair is [number, number] => pair[0] !== null && pair[1] !== null);
    // Center: the circle's, else the polygon's average, else the address's.
    let lat = num(circle?.latitude);
    let lng = num(circle?.longitude);
    if ((lat === null || lng === null) && vertices.length > 0) {
      lat = vertices.reduce((sum, pair) => sum + pair[0], 0) / vertices.length;
      lng = vertices.reduce((sum, pair) => sum + pair[1], 0) / vertices.length;
    }
    if (lat === null || lng === null) {
      lat = num(row.latitude);
      lng = num(row.longitude);
    }
    if (lat === null || lng === null) continue;
    places.push({
      id: row.id,
      name: str(row.name) || str(row.formattedAddress) || "Place",
      address: str(row.formattedAddress),
      lat,
      lng,
      radiusMeters: num(circle?.radiusMeters),
      polygon: vertices.length >= 3 ? vertices : null,
      types: Array.isArray(row.addressTypes) ? row.addressTypes.filter((type) => typeof type === "string") : []
    });
  }
  return places.sort((a, b) => a.name.localeCompare(b.name));
}
