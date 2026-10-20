"use client";

import "leaflet/dist/leaflet.css";
import type { Map as LeafletMap, Marker as LeafletMarker } from "leaflet";
import { Loader2, Maximize2, Minimize2, RotateCw, Search, TrafficCone } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { authedFetch } from "@/lib/auth";
import type { FleetItem, FleetKind } from "@/lib/samsara";

// Live map of every truck, trailer and tracked piece of equipment from
// Samsara. Pins are colored by kind; the list beside the map finds and flies
// to one. Refreshes every minute. "Expand" fills the screen (Esc to exit).

const REFRESH_MS = 60_000;

const KINDS: Array<{ kind: FleetKind; label: string; plural: string; color: string }> = [
  { kind: "truck", label: "Truck", plural: "Trucks", color: "#2a6b40" },
  { kind: "trailer", label: "Trailer", plural: "Trailers", color: "#c2410c" },
  { kind: "yard", label: "Yard", plural: "Yards", color: "#7c3aed" },
  { kind: "equipment", label: "Equipment", plural: "Equipment", color: "#1d4ed8" },
  { kind: "asset", label: "Asset", plural: "Other", color: "#6c7a86" }
];
const kindInfo = (kind: FleetKind) => KINDS.find((item) => item.kind === kind) ?? KINDS[KINDS.length - 1];

// Map icon glyphs (lucide paths) drawn inside each pin.
const GLYPHS: Record<FleetKind, string> = {
  truck:
    '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
  trailer: '<rect x="2" y="5" width="16" height="11" rx="1"/><path d="M18 13h4"/><circle cx="7" cy="18" r="2"/><circle cx="13" cy="18" r="2"/>',
  yard: '<path d="M22 8.35V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.35A2 2 0 0 1 3.26 6.5l8-3.2a2 2 0 0 1 1.48 0l8 3.2A2 2 0 0 1 22 8.35Z"/><path d="M6 18h12"/><path d="M6 14h12"/><rect x="6" y="10" width="12" height="12"/>',
  equipment: '<path d="M2 20h20"/><path d="M5 20V8l7-5 7 5v12"/><path d="M9 20v-6h6v6"/>',
  asset: '<circle cx="12" cy="10" r="3"/><path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/>'
};

function pinHtml(kind: FleetKind, selected: boolean): string {
  const { color } = kindInfo(kind);
  const size = selected ? 40 : 32;
  return `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:${color};border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35);display:grid;place-items:center;transition:all .15s">
    <svg width="${size / 2}" height="${size / 2}" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${GLYPHS[kind]}</svg></div>`;
}

function timeAgo(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hr ago`;
  return `${Math.round(hours / 24)} days ago`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function popupHtml(item: FleetItem): string {
  const info = kindInfo(item.kind);
  const moving = item.speedMph !== null && item.speedMph > 2 ? `${Math.round(item.speedMph)} mph` : "Parked";
  return `<div style="font-family:inherit;min-width:180px">
    <div style="font-size:11px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:${info.color}">${info.label}${item.size ? ` · ${item.size}` : ""}</div>
    <div style="font-size:15px;font-weight:900;margin:2px 0 4px">${escapeHtml(item.name)}</div>
    ${item.address ? `<div style="font-size:12px;font-weight:600;color:#26333f">${escapeHtml(item.address)}</div>` : ""}
    <div style="font-size:12px;font-weight:700;color:#6c7a86;margin-top:4px">${moving} · ${timeAgo(item.time) || "time unknown"}</div>
  </div>`;
}

export default function FleetMap({ darkMode }: { darkMode: boolean }) {
  const [items, setItems] = useState<FleetItem[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [fetchedAt, setFetchedAt] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState<FleetKind | "all">("all");
  // Trailer length filter ("53 ft", "" = all sizes, "?" = size not in name).
  const [sizeFilter, setSizeFilter] = useState("");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [mapReady, setMapReady] = useState(false);

  const mapNode = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const markersRef = useRef<Map<string, LeafletMarker>>(new Map());
  const tilesRef = useRef<import("leaflet").TileLayer | null>(null);
  // Live traffic (TomTom flow tiles) drawn over the basemap, toggled by the
  // Traffic button; the key comes from /api/samsara/traffic for allowed logins.
  const trafficRef = useRef<import("leaflet").TileLayer | null>(null);
  const [trafficOn, setTrafficOn] = useState(false);
  const [trafficKey, setTrafficKey] = useState("");
  const [trafficError, setTrafficError] = useState("");
  const fittedRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await authedFetch("/api/samsara/fleet");
      const result = (await response.json()) as { ok?: boolean; items?: FleetItem[]; warnings?: string[]; fetchedAt?: string; error?: string };
      if (!response.ok || !result.ok) {
        setError(result.error || `Samsara didn't answer (${response.status}).`);
      } else {
        setError("");
        setItems(result.items ?? []);
        setWarnings(result.warnings ?? []);
        setFetchedAt(result.fetchedAt ?? "");
      }
    } catch {
      setError("Couldn't reach the server — check the connection.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  // Create the map once (Leaflet only runs in the browser).
  useEffect(() => {
    let cancelled = false;
    void import("leaflet").then((L) => {
      if (cancelled || !mapNode.current || mapRef.current) return;
      leafletRef.current = L;
      const map = L.map(mapNode.current, { zoomControl: true, attributionControl: true }).setView([34.06, -117.4], 10);
      mapRef.current = map;
      setMapReady(true);
    });
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markersRef.current.clear();
      tilesRef.current = null;
    };
  }, []);

  // Basemap, darkened to match the app in dark mode.
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    tilesRef.current?.remove();
    // OpenStreetMap's free tiles (no key). Dark mode recolors them in CSS.
    tilesRef.current = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
      className: darkMode ? "fleet-tiles-dark" : ""
    }).addTo(map);
  }, [darkMode, mapReady]);

  // Remember the Traffic choice in this browser.
  useEffect(() => {
    try {
      if (window.localStorage.getItem("mgp-fleet-traffic-v1") === "on") setTrafficOn(true);
    } catch {
      // storage blocked — start with traffic off
    }
  }, []);

  useEffect(() => {
    if (!trafficOn || trafficKey) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await authedFetch("/api/samsara/traffic");
        const result = (await response.json()) as { ok?: boolean; key?: string; error?: string };
        if (cancelled) return;
        if (response.ok && result.ok && result.key) {
          setTrafficKey(result.key);
          setTrafficError("");
        } else {
          setTrafficError(result.error || "Traffic isn't available right now.");
          setTrafficOn(false);
        }
      } catch {
        if (!cancelled) {
          setTrafficError("Couldn't load traffic — check the connection.");
          setTrafficOn(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [trafficOn, trafficKey]);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    trafficRef.current?.remove();
    trafficRef.current = null;
    if (!L || !map || !trafficOn || !trafficKey) return;
    // relative0: green = normal speed for that road, orange/red = slower, dark red = stopped.
    trafficRef.current = L.tileLayer(
      `https://api.tomtom.com/traffic/map/4/tile/flow/${darkMode ? "relative0-dark" : "relative0"}/{z}/{x}/{y}.png?key=${encodeURIComponent(trafficKey)}&thickness=8`,
      { opacity: 0.9, zIndex: 5, maxZoom: 19, attribution: 'Traffic &copy; <a href="https://www.tomtom.com">TomTom</a>' }
    ).addTo(map);
  }, [trafficOn, trafficKey, darkMode, mapReady]);

  function toggleTraffic() {
    const next = !trafficOn;
    setTrafficError("");
    setTrafficOn(next);
    try {
      window.localStorage.setItem("mgp-fleet-traffic-v1", next ? "on" : "off");
    } catch {
      // storage blocked — the toggle still works for this visit
    }
  }

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter(
      (item) =>
        (filter === "all" || item.kind === filter) &&
        (filter !== "trailer" || !sizeFilter || (sizeFilter === "?" ? !item.size : item.size === sizeFilter)) &&
        (!needle || item.name.toLowerCase().includes(needle) || item.address.toLowerCase().includes(needle))
    );
  }, [items, filter, sizeFilter, query]);

  // Trailer lengths present, longest first, with counts.
  const sizes = useMemo(() => {
    const tally = new Map<string, number>();
    for (const item of items) if (item.kind === "trailer") tally.set(item.size || "?", (tally.get(item.size || "?") ?? 0) + 1);
    return Array.from(tally.entries()).sort((a, b) => (b[0] === "?" ? -1 : a[0] === "?" ? 1 : parseInt(b[0]) - parseInt(a[0])));
  }, [items]);

  // Sync pins with what's shown.
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    const keep = new Set(visible.map((item) => item.id));
    for (const [id, marker] of markersRef.current) {
      if (!keep.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    }
    for (const item of visible) {
      const icon = L.divIcon({ html: pinHtml(item.kind, item.id === selectedId), className: "", iconSize: [40, 40], iconAnchor: [20, 20], popupAnchor: [0, -18] });
      const existing = markersRef.current.get(item.id);
      if (existing) {
        existing.setLatLng([item.lat, item.lng]).setIcon(icon).setPopupContent(popupHtml(item));
        existing.setZIndexOffset(item.id === selectedId ? 1000 : 0);
      } else {
        const marker = L.marker([item.lat, item.lng], { icon, title: item.name, zIndexOffset: item.id === selectedId ? 1000 : 0 })
          .bindPopup(popupHtml(item))
          .on("click", () => setSelectedId(item.id))
          .addTo(map);
        markersRef.current.set(item.id, marker);
      }
    }
    // Frame everything the first time pins arrive.
    if (!fittedRef.current && visible.length > 0) {
      fittedRef.current = true;
      map.fitBounds(L.latLngBounds(visible.map((item) => [item.lat, item.lng] as [number, number])), { padding: [40, 40], maxZoom: 13 });
    }
  }, [visible, selectedId, mapReady]);

  // Expanded ⇄ inline: let Leaflet re-measure, and Esc exits.
  useEffect(() => {
    const timer = window.setTimeout(() => mapRef.current?.invalidateSize(), 60);
    if (!expanded) return () => window.clearTimeout(timer);
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setExpanded(false);
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [expanded]);

  function focus(item: FleetItem) {
    setSelectedId(item.id);
    mapRef.current?.flyTo([item.lat, item.lng], Math.max(mapRef.current.getZoom(), 14), { duration: 0.6 });
    markersRef.current.get(item.id)?.openPopup();
  }

  function fitAll() {
    const L = leafletRef.current;
    if (!L || !mapRef.current || visible.length === 0) return;
    mapRef.current.fitBounds(L.latLngBounds(visible.map((item) => [item.lat, item.lng] as [number, number])), { padding: [40, 40], maxZoom: 13 });
  }

  const counts = useMemo(() => {
    const result: Record<string, number> = { all: items.length };
    for (const item of items) result[item.kind] = (result[item.kind] ?? 0) + 1;
    return result;
  }, [items]);

  const muted = darkMode ? "text-steel-100" : "text-steel-500";
  const chip = (active: boolean) =>
    `rounded-full px-3 py-1.5 text-xs font-black transition ${
      active ? "bg-steel-900 text-white" : darkMode ? "bg-white/10 text-white hover:bg-white/15" : "bg-steel-100 text-steel-900 hover:bg-steel-50"
    }`;

  return (
    <div
      className={
        expanded
          ? `fixed inset-0 z-[1000] flex flex-col gap-3 p-3 sm:p-4 ${darkMode ? "bg-steel-900 text-white" : "bg-steel-50 text-steel-900"}`
          : "mt-4 flex flex-col gap-3"
      }
      role={expanded ? "dialog" : undefined}
      aria-label={expanded ? "Live fleet map" : undefined}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className={chip(filter === "all")} onClick={() => { setFilter("all"); setSizeFilter(""); }}>
            All {counts.all ?? 0}
          </button>
          {KINDS.filter((info) => (counts[info.kind] ?? 0) > 0 || info.kind === "truck" || info.kind === "trailer").map((info) => (
            <button key={info.kind} type="button" className={chip(filter === info.kind)} onClick={() => { setFilter(info.kind); setSizeFilter(""); }}>
              <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: info.color }} />
              {info.plural} {counts[info.kind] ?? 0}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-bold ${muted}`}>{fetchedAt ? `Updated ${timeAgo(fetchedAt)}` : ""}</span>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            aria-label="Refresh"
            className={`rounded border p-2 ${darkMode ? "border-white/15 hover:bg-white/10" : "border-steel-100 bg-white hover:bg-steel-50"}`}
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <RotateCw size={16} />}
          </button>
          <button
            type="button"
            onClick={toggleTraffic}
            aria-pressed={trafficOn}
            className={`flex items-center gap-1.5 rounded border px-3 py-2 text-sm font-black transition ${
              trafficOn
                ? "border-red-600 bg-red-600 text-white hover:bg-red-700"
                : darkMode
                  ? "border-white/15 hover:bg-white/10"
                  : "border-steel-100 bg-white text-steel-900 hover:bg-steel-50"
            }`}
          >
            <TrafficCone size={16} />
            Traffic
          </button>
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="flex items-center gap-1.5 rounded bg-steel-900 px-3 py-2 text-sm font-black text-white hover:bg-steel-800"
          >
            {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            {expanded ? "Exit full screen" : "Expand"}
          </button>
        </div>
      </div>

      {filter === "trailer" && sizes.length > 1 && (
        <div className="-mt-1 flex flex-wrap items-center gap-1.5">
          <span className={`mr-1 text-xs font-black uppercase tracking-wide ${muted}`}>Size</span>
          <button type="button" className={chip(sizeFilter === "")} onClick={() => setSizeFilter("")}>
            All sizes
          </button>
          {sizes.map(([size, count]) => (
            <button key={size} type="button" className={chip(sizeFilter === size)} onClick={() => setSizeFilter(size)}>
              {size === "?" ? "Size not listed" : size} {count}
            </button>
          ))}
        </div>
      )}

      {trafficError && (
        <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-900">Traffic: {trafficError}</div>
      )}

      {error && (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800">{error}</div>
      )}
      {warnings.length > 0 && !error && (
        <details className={`rounded border p-2 text-xs font-bold ${darkMode ? "border-white/15" : "border-steel-100 bg-white"}`}>
          <summary className="cursor-pointer text-amber-700">Some Samsara data didn't load ({warnings.length})</summary>
          <ul className={`mt-1 list-disc pl-5 ${muted}`}>
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </details>
      )}

      <div className={`grid min-h-0 gap-3 ${expanded ? "flex-1 lg:grid-cols-[1fr_320px]" : "lg:grid-cols-[1fr_300px]"}`}>
        <div
          className={`relative isolate overflow-hidden rounded border ${darkMode ? "border-white/10" : "border-steel-100"} ${expanded ? "min-h-[50vh]" : "h-[420px]"}`}
        >
          <div ref={mapNode} className="absolute inset-0 z-0" />
          <button
            type="button"
            onClick={fitAll}
            className="absolute bottom-3 left-3 z-[500] rounded bg-white px-3 py-1.5 text-xs font-black text-steel-900 shadow-md hover:bg-steel-50"
          >
            Show all
          </button>
          {trafficOn && trafficKey && (
            <div className="absolute bottom-3 right-3 z-[500] mb-5 flex items-center gap-2.5 rounded bg-white/95 px-3 py-1.5 text-[11px] font-black text-steel-900 shadow-md">
              <span className="flex items-center gap-1"><span className="h-1.5 w-4 rounded-full" style={{ background: "#2fb14f" }} />Normal</span>
              <span className="flex items-center gap-1"><span className="h-1.5 w-4 rounded-full" style={{ background: "#f59e0b" }} />Slow</span>
              <span className="flex items-center gap-1"><span className="h-1.5 w-4 rounded-full" style={{ background: "#dc2626" }} />Heavy</span>
              <span className="flex items-center gap-1"><span className="h-1.5 w-4 rounded-full" style={{ background: "#7f1d1d" }} />Stopped</span>
            </div>
          )}
          {!loading && !error && items.length === 0 && (
            <div className="absolute inset-0 z-[500] grid place-items-center bg-white/70 text-sm font-black text-steel-500">
              No trucks or trailers reported a location yet.
            </div>
          )}
        </div>

        <div className={`flex min-h-0 flex-col rounded border ${darkMode ? "border-white/10 bg-white/[0.04]" : "border-steel-100 bg-white"} ${expanded ? "max-h-[40vh] lg:max-h-none" : "h-[420px]"}`}>
          <label className={`flex items-center gap-2 border-b px-3 py-2 ${darkMode ? "border-white/10" : "border-steel-100"}`}>
            <Search size={16} className={muted} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name or address"
              className="w-full bg-transparent text-sm font-bold outline-none"
              style={{ fontSize: 14 }}
            />
          </label>
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {visible.map((item) => {
              const info = kindInfo(item.kind);
              const moving = item.speedMph !== null && item.speedMph > 2;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => focus(item)}
                    className={`flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition ${
                      item.id === selectedId ? (darkMode ? "bg-white/10" : "bg-steel-50") : darkMode ? "hover:bg-white/[0.06]" : "hover:bg-steel-50"
                    }`}
                  >
                    <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: info.color }} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-black" title={item.name}>{item.name}</span>
                        <span className={`shrink-0 text-[11px] font-black ${moving ? "text-workshop-500" : muted}`}>
                          {moving ? `${Math.round(item.speedMph ?? 0)} mph` : "Parked"}
                        </span>
                      </span>
                      <span className={`block truncate text-xs font-bold ${muted}`}>{item.address || `${item.lat.toFixed(4)}, ${item.lng.toFixed(4)}`}</span>
                      <span className={`block text-[11px] font-bold ${muted}`}>
                        {info.label}
                        {item.size ? ` · ${item.size}` : ""} · {timeAgo(item.time) || "time unknown"}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
            {visible.length === 0 && !loading && (
              <li className={`px-3 py-6 text-center text-sm font-bold ${muted}`}>{items.length ? "Nothing matches." : "Nothing to show yet."}</li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
