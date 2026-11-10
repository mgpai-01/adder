"use client";

import { MapPin, Route, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { insideGeofence, type Geofence } from "@/lib/geo";
import type { FleetItem, FleetPlace } from "@/lib/samsara";
import type { YardArea } from "@/lib/yards";

// Under the map on the Fleet tab, laid out like the Production Grid's yard
// sections: MGP's yards first, always, then any Samsara geofence pinned from
// the search box. Each section has the yard name over a green rule, number
// boxes (trucks, trailers, each trailer length, total), its own search, and a
// dark-header table of every unit in it — rebuilt from the live positions on
// every refresh, so units move between sections as they move between yards.

const PINNED_KEY = "mgp-fleet-pinned-places-v1";
const MOVING_MPH = 2;

function ago(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "—";
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} hr ago` : `${Math.round(hours / 24)} days ago`;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

export default function FleetSections({
  items,
  yards,
  yardOf,
  places,
  unitLabel,
  darkMode,
  onFocus,
  onEta,
  onZoom
}: {
  items: FleetItem[];
  yards: YardArea[];
  yardOf: Map<string, YardArea>;
  places: FleetPlace[];
  unitLabel: (item: FleetItem) => string;
  darkMode: boolean;
  onFocus: (item: FleetItem) => void;
  onEta: (item: FleetItem) => void;
  onZoom: (area: Geofence) => void;
}) {
  // Geofences pinned from the search, remembered in this browser.
  const [pinned, setPinned] = useState<string[]>([]);
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(PINNED_KEY) ?? "[]");
      if (Array.isArray(saved)) setPinned(saved.filter((id) => typeof id === "string"));
    } catch {
      // storage blocked — start with nothing pinned
    }
  }, []);
  function savePinned(next: string[]) {
    setPinned(next);
    try {
      window.localStorage.setItem(PINNED_KEY, JSON.stringify(next));
    } catch {
      // storage blocked — pins last for this visit
    }
  }

  const unitsIn = (place: FleetPlace) => items.filter((item) => insideGeofence(place, item.lat, item.lng, 150));
  const yardPlaceIds = new Set(yards.map((yard) => yard.placeId).filter(Boolean));

  // Geofence search across every Samsara place.
  const [query, setQuery] = useState("");
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return places
      .filter((place) => place.name.toLowerCase().includes(needle) || place.address.toLowerCase().includes(needle))
      .slice(0, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, places]);

  function pick(place: FleetPlace) {
    onZoom(place);
    setQuery("");
    if (yardPlaceIds.has(place.id) || pinned.includes(place.id)) return;
    savePinned([...pinned, place.id]);
  }

  const line = darkMode ? "border-white/10" : "border-steel-100";
  const muted = darkMode ? "text-steel-100" : "text-steel-500";
  const pinnedPlaces = pinned.map((id) => places.find((place) => place.id === id)).filter((place): place is FleetPlace => Boolean(place));

  return (
    <div className="grid gap-2">
      {/* Search any Samsara geofence; picking one zooms the map and pins it. */}
      <div className={`relative rounded border p-3 ${darkMode ? "border-white/10 bg-white/[0.04]" : "border-steel-100 bg-white"}`}>
        <label className={`flex items-center gap-2 rounded border-2 px-3 py-2.5 ${darkMode ? "border-white/30" : "border-steel-900"}`}>
          <Search size={18} className={muted} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search any geofence — all ${places.length} from Samsara`}
            className="w-full bg-transparent font-bold outline-none"
            style={{ fontSize: 16 }}
          />
          {query && (
            <button type="button" aria-label="Clear" onClick={() => setQuery("")} className="min-h-0">
              <X size={16} />
            </button>
          )}
        </label>
        {query.trim() && (
          <ul className={`mt-1 overflow-hidden rounded border text-sm font-bold ${line}`}>
            {matches.length === 0 && <li className={`px-3 py-2 ${muted}`}>No geofence matches “{query.trim()}”.</li>}
            {matches.map((place) => {
              const count = unitsIn(place).length;
              return (
                <li key={place.id}>
                  <button
                    type="button"
                    onClick={() => pick(place)}
                    className={`flex min-h-0 w-full items-center justify-between gap-3 px-3 py-2 text-left ${darkMode ? "hover:bg-white/10" : "hover:bg-steel-50"}`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <MapPin size={14} className="shrink-0" />
                      <span className="truncate">{place.name}</span>
                    </span>
                    <span className={`shrink-0 text-xs ${muted}`}>{count ? `${plural(count, "unit")} there now` : "empty"}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {pinnedPlaces.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs font-black">
            <span className={muted}>Pinned below:</span>
            {pinnedPlaces.map((place) => (
              <span key={place.id} className="flex items-center gap-1 rounded-full bg-violet-100 py-1 pl-3 pr-1 text-violet-800">
                {place.name}
                <button
                  type="button"
                  aria-label={`Unpin ${place.name}`}
                  onClick={() => savePinned(pinned.filter((id) => id !== place.id))}
                  className="min-h-0 rounded-full p-0.5 hover:bg-violet-200"
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {yards.map((yard) => (
        <Section
          key={yard.id}
          title={yard.name}
          subtitle={yard.placeName ? `Geofence: ${yard.placeName}` : "250 m around the address"}
          units={items.filter((item) => yardOf.get(item.id)?.id === yard.id)}
          onZoom={() => onZoom(yard)}
          {...{ unitLabel, darkMode, onFocus, onEta }}
        />
      ))}
      {pinnedPlaces.map((place) => (
        <Section
          key={place.id}
          title={place.name}
          subtitle={place.address ? `Samsara place · ${place.address}` : "Samsara place"}
          units={unitsIn(place)}
          onZoom={() => onZoom(place)}
          onUnpin={() => savePinned(pinned.filter((id) => id !== place.id))}
          {...{ unitLabel, darkMode, onFocus, onEta }}
        />
      ))}
    </div>
  );
}

function Section({
  title,
  subtitle,
  units,
  unitLabel,
  darkMode,
  onFocus,
  onEta,
  onZoom,
  onUnpin
}: {
  title: string;
  subtitle: string;
  units: FleetItem[];
  unitLabel: (item: FleetItem) => string;
  darkMode: boolean;
  onFocus: (item: FleetItem) => void;
  onEta: (item: FleetItem) => void;
  onZoom: () => void;
  onUnpin?: () => void;
}) {
  const [query, setQuery] = useState("");
  const muted = darkMode ? "text-steel-100" : "text-steel-500";
  const line = darkMode ? "border-white/10" : "border-steel-100";

  const trucks = units.filter((item) => item.kind === "truck");
  const trailers = units.filter((item) => item.kind === "trailer");
  const sizes = Array.from(new Set(trailers.map((item) => item.size).filter(Boolean))).sort((a, b) => parseInt(b) - parseInt(a));

  // Trucks first, then trailers, each by unit number.
  const sorted = [...units].sort(
    (a, b) =>
      Number(b.kind === "truck") - Number(a.kind === "truck") ||
      unitLabel(a).localeCompare(unitLabel(b), undefined, { numeric: true })
  );
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? sorted.filter((item) =>
        [item.name, unitLabel(item), item.size, item.kind, item.kind === "truck" ? "truck" : "trailer", item.address]
          .join(" ")
          .toLowerCase()
          .includes(needle)
      )
    : sorted;

  const box = "flex h-12 min-w-[110px] items-center justify-center rounded px-3 text-base font-black";
  const light = darkMode ? "bg-workshop-700/50 text-white" : "bg-safety-400/70 text-steel-900";

  return (
    <section className="mt-6">
      <div className="flex items-end justify-between gap-3 border-b-2 border-workshop-500 pb-2">
        <button type="button" onClick={onZoom} className="min-h-0 text-left text-2xl font-black uppercase hover:underline" title="Show on the map">
          {title}
        </button>
        <span className={`shrink-0 text-base font-black ${muted}`}>
          {plural(trucks.length, "truck")} · {plural(trailers.length, "trailer")}
        </span>
      </div>
      <div className={`mt-3 rounded border p-3 ${darkMode ? "border-white/10 bg-white/[0.03]" : "border-steel-100 bg-steel-50"}`}>
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-auto min-w-0">
            <p className="truncate text-lg font-black">{title}</p>
            <p className={`truncate text-sm font-bold ${muted}`}>{subtitle}</p>
          </div>
          <span className={`${box} ${light}`}>{plural(trucks.length, "truck")}</span>
          <span className={`${box} ${light}`}>{plural(trailers.length, "trailer")}</span>
          {sizes.map((size) => (
            <span key={size} className={`${box} ${light}`}>
              {size} · {trailers.filter((item) => item.size === size).length}
            </span>
          ))}
          <span className={`${box} bg-workshop-500 text-white`}>{units.length} total</span>
          {onUnpin && (
            <button type="button" onClick={onUnpin} className={`min-h-0 rounded border px-3 py-2 text-xs font-black ${line}`}>
              Unpin
            </button>
          )}
        </div>

        <label className={`mt-3 flex items-center gap-2 rounded border px-3 py-2 ${line} ${darkMode ? "bg-white/[0.04]" : "bg-white"}`}>
          <Search size={16} className={muted} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${title} — unit #, name, size…`}
            className="w-full bg-transparent text-sm font-bold outline-none"
            style={{ fontSize: 14 }}
          />
          {needle && (
            <>
              <span className="shrink-0 rounded-full bg-steel-900 px-2 py-0.5 text-[11px] font-black text-white">
                {shown.length} of {units.length} shown
              </span>
              <button type="button" onClick={() => setQuery("")} className={`min-h-0 shrink-0 text-xs font-black ${muted}`}>
                ✕ Clear
              </button>
            </>
          )}
        </label>

        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="bg-steel-900 text-white">
                <th className="px-3 py-2.5 text-left font-black">Unit</th>
                <th className="px-3 py-2.5 text-left font-black">Full name</th>
                <th className="px-3 py-2.5 text-center font-black">Type</th>
                <th className="px-3 py-2.5 text-center font-black">Size</th>
                <th className="px-3 py-2.5 text-center font-black">Status</th>
                <th className="px-3 py-2.5 text-center font-black">Last GPS</th>
                <th className="bg-safety-400 px-3 py-2.5 text-center font-black text-steel-900">Drive time</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((item, index) => {
                const moving = (item.speedMph ?? 0) > MOVING_MPH;
                return (
                  <tr key={item.id} className={`border-t ${line} ${index % 2 ? (darkMode ? "bg-white/[0.03]" : "bg-steel-50") : darkMode ? "" : "bg-white"}`}>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => onFocus(item)}
                        title="Show on the map"
                        className="min-h-0 rounded px-2 py-0.5 text-xs font-black text-white"
                        style={{ background: item.kind === "truck" ? "#2a6b40" : item.kind === "trailer" ? "#c2410c" : "#6c7a86" }}
                      >
                        {unitLabel(item)}
                      </button>
                    </td>
                    <td className="max-w-[360px] truncate px-3 py-2 font-bold" title={item.name}>
                      {item.name}
                    </td>
                    <td className="px-3 py-2 text-center font-bold capitalize">{item.kind === "asset" ? "Other" : item.kind}</td>
                    <td className="px-3 py-2 text-center font-bold">{item.size || "—"}</td>
                    <td className={`px-3 py-2 text-center font-black ${moving ? "text-workshop-500" : muted}`}>
                      {moving ? `${Math.round(item.speedMph ?? 0)} mph` : "Parked"}
                    </td>
                    <td className={`px-3 py-2 text-center font-bold ${muted}`}>{ago(item.time)}</td>
                    <td className={`px-3 py-2 text-center ${darkMode ? "bg-workshop-700/30" : "bg-workshop-100"}`}>
                      <button
                        type="button"
                        onClick={() => onEta(item)}
                        className="mx-auto flex min-h-0 items-center gap-1 rounded bg-workshop-500 px-2 py-1 text-xs font-black text-white hover:bg-workshop-700"
                      >
                        <Route size={12} /> ETA
                      </button>
                    </td>
                  </tr>
                );
              })}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={7} className={`px-3 py-4 text-center text-sm font-bold ${muted}`}>
                    {units.length === 0 ? "Nothing here right now." : `Nothing matches “${query.trim()}”.`}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
