"use client";

import { AlertTriangle, Bell, BellOff, Check, MapPin, Route, Search, Truck, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import YardBoard from "@/components/YardBoard";
import { insideGeofence, type Geofence } from "@/lib/geo";
import type { FleetItem, FleetPlace, SilentUnit } from "@/lib/samsara";
import type { YardArea } from "@/lib/yards";

// Under the map on the Fleet tab, laid out like the Production Grid's yard
// sections: MGP's yards first, always, then any Samsara geofence pinned from
// the search box. Each section has the yard name over a green rule, number
// boxes (trucks, trailers, each trailer length, total), its own search, and a
// dark-header table of every unit in it — rebuilt from the live positions on
// every refresh, so units move between sections as they move between yards.
//
// Tabs pick what's under the search bars: those yard sections, the compact
// Yard board (every yard side by side), what's on the road / not at a yard,
// or every unit. The truck/trailer search finds any unit whichever tab is open.

type Tab = "yards" | "board" | "road" | "all" | "nogps" | "tamper";
const TABS: { id: Tab; label: string }[] = [
  { id: "yards", label: "Yards & pinned places" },
  { id: "board", label: "Yard board" },
  { id: "road", label: "On the road" },
  { id: "all", label: "All units" },
  { id: "nogps", label: "No GPS 24h+" },
  { id: "tamper", label: "Tamper" }
];

// "Tamper" (critical): the tracker's last ping had the unit moving, and then
// it went silent. A normal stop reports 0 mph before the tracker sleeps, so
// going dark mid-drive points to it being unplugged, cut, covered or blocked
// (or a long dead zone). Trailer trackers report less often, so they get a
// longer grace period. "Mark checked" clears one event; if the same unit goes
// dark while moving again later, it alerts again.
const DARK_TRUCK_MS = 30 * 60 * 1000;
const DARK_OTHER_MS = 2 * 60 * 60 * 1000;
const CHECKED_KEY = "mgp-fleet-tamper-checked-v1";

// "No GPS": a unit whose last ping is older than this. Muted units (one in
// the shop, say) are left out until the mute ends — saved in this browser.
const NO_GPS_MS = 24 * 60 * 60 * 1000;
const MUTE_KEY = "mgp-fleet-gps-mute-v1";
const MUTE_MS = 7 * 24 * 60 * 60 * 1000;
const TAB_KEY = "mgp-fleet-tab-v1";

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
  silent = [],
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
  silent?: SilentUnit[];
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

  const [tab, setTab] = useState<Tab>("yards");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(TAB_KEY);
      if (saved && TABS.some((entry) => entry.id === saved)) setTab(saved as Tab);
    } catch {
      // storage blocked — start on Yards
    }
  }, []);
  function chooseTab(next: Tab) {
    setTab(next);
    try {
      window.localStorage.setItem(TAB_KEY, next);
    } catch {
      // storage blocked — tab lasts for this visit
    }
  }

  // Muted "No GPS" units: id → muted until (ms). Expired mutes drop off.
  const [mutes, setMutes] = useState<Record<string, number>>({});
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(MUTE_KEY) ?? "{}") as Record<string, unknown>;
      const now = Date.now();
      setMutes(Object.fromEntries(Object.entries(saved).filter((entry): entry is [string, number] => typeof entry[1] === "number" && entry[1] > now)));
    } catch {
      // storage blocked — nothing muted
    }
  }, []);
  function saveMuted(next: Record<string, number>) {
    setMutes(next);
    try {
      window.localStorage.setItem(MUTE_KEY, JSON.stringify(next));
    } catch {
      // storage blocked — mute lasts for this visit
    }
  }
  const isMuted = (id: string) => (mutes[id] ?? 0) > Date.now();
  const lastPing = (item: FleetItem) => Date.parse(item.time);
  const quiet = items
    .filter((item) => Number.isFinite(lastPing(item)) && Date.now() - lastPing(item) > NO_GPS_MS)
    .sort((a, b) => lastPing(a) - lastPing(b));
  const quietCount = quiet.filter((item) => !isMuted(item.id)).length + silent.filter((unit) => !isMuted(unit.id)).length;

  const [checked, setChecked] = useState<string[]>([]);
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(CHECKED_KEY) ?? "[]");
      if (Array.isArray(saved)) setChecked(saved.filter((entry) => typeof entry === "string").slice(-500));
    } catch {
      // storage blocked — nothing checked yet
    }
  }, []);
  const eventKey = (item: FleetItem) => `${item.id}@${item.time}`;
  function markChecked(item: FleetItem) {
    const next = [...checked.filter((key) => key !== eventKey(item)), eventKey(item)].slice(-500);
    setChecked(next);
    try {
      window.localStorage.setItem(CHECKED_KEY, JSON.stringify(next));
    } catch {
      // storage blocked — lasts for this visit
    }
  }
  const tampered = items
    .filter((item) => {
      const age = Date.now() - lastPing(item);
      return (item.speedMph ?? 0) > MOVING_MPH && Number.isFinite(age) && age > (item.kind === "truck" ? DARK_TRUCK_MS : DARK_OTHER_MS);
    })
    .sort((a, b) => lastPing(b) - lastPing(a));
  const openTamper = tampered.filter((item) => !checked.includes(eventKey(item)));
  // The Tamper tab only exists while an alert is open; once the last one is
  // checked (or the unit reports again), go back to the yards.
  const tamperShown = openTamper.length > 0;
  useEffect(() => {
    if (tab === "tamper" && !tamperShown) setTab("yards");
  }, [tab, tamperShown]);

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

  // Where a unit is, in words: its yard, else the street Samsara reported.
  const whereOf = (item: FleetItem) =>
    yardOf.get(item.id)?.name ?? (item.address || `${item.lat.toFixed(4)}, ${item.lng.toFixed(4)}`);
  const isMoving = (item: FleetItem) => (item.speedMph ?? 0) > MOVING_MPH;
  const away = items.filter((item) => !yardOf.has(item.id));

  // Truck / trailer search across every unit.
  const [unitQuery, setUnitQuery] = useState("");
  const unitMatches = useMemo(() => {
    const needle = unitQuery.trim().toLowerCase();
    if (!needle) return [];
    return items
      .filter((item) => [item.name, unitLabel(item), item.address, yardOf.get(item.id)?.name ?? ""].join(" ").toLowerCase().includes(needle))
      .sort((a, b) => unitLabel(a).localeCompare(unitLabel(b), undefined, { numeric: true }))
      .slice(0, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitQuery, items, yardOf]);

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
      {/* Critical: a tracker went dark while its unit was moving. */}
      {openTamper.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded border-2 border-red-700 bg-red-600 px-4 py-3 text-white shadow-lg" role="alert">
          <AlertTriangle size={26} className="shrink-0 animate-pulse" />
          <div className="min-w-0 flex-1">
            <p className="text-base font-black uppercase tracking-wide">
              Critical · {openTamper.length === 1 ? "1 tracker" : `${openTamper.length} trackers`} stopped reporting while moving
            </p>
            <p className="truncate text-sm font-bold text-white/90">
              {openTamper
                .slice(0, 4)
                .map((item) => `${unitLabel(item)} (${Math.round(item.speedMph ?? 0)} mph, ${ago(item.time)})`)
                .join(" · ")}
              {openTamper.length > 4 ? ` · +${openTamper.length - 4} more` : ""} — may be unplugged, cut or blocked
            </p>
          </div>
          <button
            type="button"
            onClick={() => chooseTab("tamper")}
            className="min-h-0 shrink-0 rounded bg-white px-4 py-2 text-sm font-black text-red-700 hover:bg-red-50"
          >
            Review →
          </button>
        </div>
      )}

      {/* Tabs: what shows under the search bars. */}
      <div className="flex flex-wrap gap-1.5" role="tablist">
        {TABS.filter((entry) => entry.id !== "tamper" || tamperShown).map((entry) => {
          const count =
            entry.id === "road" ? away.length : entry.id === "all" ? items.length : entry.id === "nogps" ? quietCount : entry.id === "tamper" ? openTamper.length : null;
          const on = tab === entry.id;
          if (entry.id === "nogps" || entry.id === "tamper") {
            const alarm = (count ?? 0) > 0;
            return (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => chooseTab(entry.id)}
                className={`flex min-h-0 items-center gap-2 rounded border px-4 py-2.5 text-sm font-black transition ${
                  on
                    ? alarm
                      ? "border-red-600 bg-red-600 text-white"
                      : darkMode
                        ? "border-white bg-white text-steel-900"
                        : "border-steel-900 bg-steel-900 text-white"
                    : alarm
                      ? darkMode
                        ? "border-red-500/60 bg-red-500/10 text-red-300 hover:bg-red-500/20"
                        : "border-red-300 bg-red-50 text-red-700 hover:bg-red-100"
                      : darkMode
                        ? "border-white/10 bg-white/[0.04] hover:bg-white/10"
                        : "border-steel-100 bg-white hover:bg-steel-50"
                }`}
              >
                {alarm && <AlertTriangle size={15} className={entry.id === "tamper" ? "animate-pulse" : ""} />}
                {entry.label}
                <span className={`rounded-full px-2 text-[11px] ${on && alarm ? "bg-white text-red-700" : alarm ? "bg-red-600 text-white" : "bg-safety-400 text-steel-900"}`}>{count}</span>
              </button>
            );
          }
          return (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => chooseTab(entry.id)}
              className={`flex min-h-0 items-center gap-2 rounded border px-4 py-2.5 text-sm font-black transition ${
                on
                  ? darkMode
                    ? "border-white bg-white text-steel-900"
                    : "border-steel-900 bg-steel-900 text-white"
                  : darkMode
                    ? "border-white/10 bg-white/[0.04] hover:bg-white/10"
                    : "border-steel-100 bg-white hover:bg-steel-50"
              }`}
            >
              {entry.label}
              {count !== null && <span className="rounded-full bg-safety-400 px-2 text-[11px] text-steel-900">{count}</span>}
            </button>
          );
        })}
      </div>

      <div className="grid gap-2 md:grid-cols-2">
      {/* Find any truck or trailer; picking one shows it on the map. */}
      <div className={`relative rounded border p-3 ${darkMode ? "border-white/10 bg-white/[0.04]" : "border-steel-100 bg-white"}`}>
        <label className={`flex items-center gap-2 rounded border-2 px-3 py-2.5 ${darkMode ? "border-white/30" : "border-steel-900"}`}>
          <Truck size={18} className={muted} />
          <input
            value={unitQuery}
            onChange={(event) => setUnitQuery(event.target.value)}
            placeholder="Find any truck or trailer — unit #, name or street"
            className="w-full bg-transparent font-bold outline-none"
            style={{ fontSize: 16 }}
          />
          {unitQuery && (
            <button type="button" aria-label="Clear" onClick={() => setUnitQuery("")} className="min-h-0">
              <X size={16} />
            </button>
          )}
        </label>
        {unitQuery.trim() && (
          <ul className={`mt-1 overflow-hidden rounded border text-sm font-bold ${line}`}>
            {unitMatches.length === 0 && <li className={`px-3 py-2 ${muted}`}>No truck or trailer matches “{unitQuery.trim()}”.</li>}
            {unitMatches.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => {
                    onFocus(item);
                    setUnitQuery("");
                  }}
                  className={`flex min-h-0 w-full items-center justify-between gap-3 px-3 py-2 text-left ${darkMode ? "hover:bg-white/10" : "hover:bg-steel-50"}`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <UnitTag item={item} label={unitLabel(item)} />
                    <span className="truncate">{item.name}</span>
                  </span>
                  <span className={`shrink-0 truncate text-xs ${muted}`} style={{ maxWidth: "45%" }}>
                    {isMoving(item) ? `${Math.round(item.speedMph ?? 0)} mph` : "Parked"} · {whereOf(item)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

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
      </div>

      {tab === "board" && (
        <div className="mt-2">
          <YardBoard items={items} yards={yards} yardOf={yardOf} unitLabel={unitLabel} darkMode={darkMode} onFocus={onFocus} onZoomYard={onZoom} />
        </div>
      )}

      {tab === "road" && (
        <Section
          title="On the road / not at a yard"
          subtitle="Moving first, then parked anywhere that isn't one of our yards"
          units={away}
          accent="orange"
          movingFirst
          whereOf={whereOf}
          boxes={[
            { label: `${away.filter(isMoving).length} moving` },
            { label: `${away.filter((item) => !isMoving(item)).length} parked elsewhere` },
            { label: `${away.length} total`, strong: true }
          ]}
          {...{ unitLabel, darkMode, onFocus, onEta }}
        />
      )}

      {tab === "all" && (
        <Section title="All units" subtitle="Every truck and trailer Samsara reports" units={items} whereOf={whereOf} {...{ unitLabel, darkMode, onFocus, onEta }} />
      )}

      {tab === "nogps" && (
        <NoGpsSection
          quiet={quiet}
          silent={silent}
          isMuted={isMuted}
          mutedUntil={(id) => mutes[id] ?? 0}
          onMute={(id) => saveMuted({ ...mutes, [id]: Date.now() + MUTE_MS })}
          onUnmute={(id) => {
            const next = { ...mutes };
            delete next[id];
            saveMuted(next);
          }}
          {...{ whereOf, unitLabel, darkMode, onFocus }}
        />
      )}

      {tab === "tamper" && (
        <TamperSection events={tampered} isChecked={(item) => checked.includes(eventKey(item))} onCheck={markChecked} {...{ whereOf, unitLabel, darkMode, onFocus }} />
      )}

      {tab === "yards" && yards.map((yard) => (
        <Section
          key={yard.id}
          title={yard.name}
          subtitle={yard.placeName ? `Geofence: ${yard.placeName}` : "250 m around the address"}
          units={items.filter((item) => yardOf.get(item.id)?.id === yard.id)}
          onZoom={() => onZoom(yard)}
          {...{ unitLabel, darkMode, onFocus, onEta }}
        />
      ))}
      {tab === "yards" && pinnedPlaces.map((place) => (
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
  onUnpin,
  whereOf,
  movingFirst = false,
  accent = "green",
  boxes
}: {
  title: string;
  subtitle: string;
  units: FleetItem[];
  unitLabel: (item: FleetItem) => string;
  darkMode: boolean;
  onFocus: (item: FleetItem) => void;
  onEta: (item: FleetItem) => void;
  onZoom?: () => void;
  onUnpin?: () => void;
  // Adds a "Where" column (yard or street) — for lists that span places.
  whereOf?: (item: FleetItem) => string;
  movingFirst?: boolean;
  accent?: "green" | "orange";
  // Replaces the trucks / trailers / sizes / total number boxes.
  boxes?: { label: string; strong?: boolean }[];
}) {
  const [query, setQuery] = useState("");
  const muted = darkMode ? "text-steel-100" : "text-steel-500";
  const line = darkMode ? "border-white/10" : "border-steel-100";

  const trucks = units.filter((item) => item.kind === "truck");
  const trailers = units.filter((item) => item.kind === "trailer");
  const sizes = Array.from(new Set(trailers.map((item) => item.size).filter(Boolean))).sort((a, b) => parseInt(b) - parseInt(a));

  // Trucks first, then trailers, each by unit number (moving first if asked).
  const speed = (item: FleetItem) => ((item.speedMph ?? 0) > MOVING_MPH ? 1 : 0);
  const sorted = [...units].sort(
    (a, b) =>
      (movingFirst ? speed(b) - speed(a) : 0) ||
      Number(b.kind === "truck") - Number(a.kind === "truck") ||
      unitLabel(a).localeCompare(unitLabel(b), undefined, { numeric: true })
  );
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? sorted.filter((item) =>
        [item.name, unitLabel(item), item.size, item.kind, item.kind === "truck" ? "truck" : "trailer", item.address, whereOf?.(item) ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(needle)
      )
    : sorted;

  const box = "flex h-12 min-w-[110px] items-center justify-center rounded px-3 text-base font-black";
  const light = darkMode ? "bg-workshop-700/50 text-white" : "bg-safety-400/70 text-steel-900";
  const orange = accent === "orange";
  const strongBox = orange ? "bg-[#c2410c] text-white" : "bg-workshop-500 text-white";
  const columns = whereOf ? 8 : 7;

  return (
    <section className="mt-6">
      <div className={`flex items-end justify-between gap-3 border-b-2 pb-2 ${orange ? "border-[#c2410c]" : "border-workshop-500"}`}>
        {onZoom ? (
          <button type="button" onClick={onZoom} className="min-h-0 text-left text-2xl font-black uppercase hover:underline" title="Show on the map">
            {title}
          </button>
        ) : (
          <h3 className="text-2xl font-black uppercase">{title}</h3>
        )}
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
          {boxes ? (
            boxes.map((entry) => (
              <span key={entry.label} className={`${box} ${entry.strong ? strongBox : orange && !darkMode ? "bg-orange-100 text-steel-900" : light}`}>
                {entry.label}
              </span>
            ))
          ) : (
            <>
              <span className={`${box} ${light}`}>{plural(trucks.length, "truck")}</span>
              <span className={`${box} ${light}`}>{plural(trailers.length, "trailer")}</span>
              {sizes.map((size) => (
                <span key={size} className={`${box} ${light}`}>
                  {size} · {trailers.filter((item) => item.size === size).length}
                </span>
              ))}
              <span className={`${box} ${strongBox}`}>{units.length} total</span>
            </>
          )}
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
          <table className={`w-full border-collapse text-sm ${whereOf ? "min-w-[900px]" : "min-w-[720px]"}`}>
            <thead>
              <tr className="bg-steel-900 text-white">
                <th className="px-3 py-2.5 text-left font-black">Unit</th>
                <th className="px-3 py-2.5 text-left font-black">Full name</th>
                <th className="px-3 py-2.5 text-center font-black">Type</th>
                <th className="px-3 py-2.5 text-center font-black">Size</th>
                <th className="px-3 py-2.5 text-center font-black">Status</th>
                {whereOf && <th className="px-3 py-2.5 text-left font-black">Where</th>}
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
                    {whereOf && (
                      <td className="max-w-[260px] truncate px-3 py-2 font-bold" title={whereOf(item)}>
                        {whereOf(item)}
                      </td>
                    )}
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
                  <td colSpan={columns} className={`px-3 py-4 text-center text-sm font-bold ${muted}`}>
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

// A unit's short number on its type's colour, as on the map pins.
function UnitTag({ item, label }: { item: FleetItem; label: string }) {
  return (
    <span
      className="shrink-0 rounded px-2 py-0.5 text-xs font-black text-white"
      style={{ background: item.kind === "truck" ? "#2a6b40" : item.kind === "trailer" ? "#c2410c" : "#6c7a86" }}
    >
      {label}
    </span>
  );
}

// The "No GPS 24h+" tab: units whose last ping is over 24 hours old (oldest
// first), then trailers with no location at all in Samsara's lookback window.
// "Show last spot" finds it on the map; "Mute 7 days" hides one you already
// know about (in the shop, parked for storage) — saved in this browser.
function NoGpsSection({
  quiet,
  silent,
  isMuted,
  mutedUntil,
  onMute,
  onUnmute,
  whereOf,
  unitLabel,
  darkMode,
  onFocus
}: {
  quiet: FleetItem[];
  silent: SilentUnit[];
  isMuted: (id: string) => boolean;
  mutedUntil: (id: string) => number;
  onMute: (id: string) => void;
  onUnmute: (id: string) => void;
  whereOf: (item: FleetItem) => string;
  unitLabel: (item: FleetItem) => string;
  darkMode: boolean;
  onFocus: (item: FleetItem) => void;
}) {
  const muted = darkMode ? "text-steel-100" : "text-steel-500";
  const line = darkMode ? "border-white/10" : "border-steel-100";
  type Row = { id: string; name: string; kind: string; label: string; item: FleetItem | null };
  const asLabel = (name: string) => unitLabel({ name } as FleetItem);
  const all: Row[] = [
    ...quiet.map((item) => ({ id: item.id, name: item.name, kind: item.kind, label: unitLabel(item), item })),
    ...silent.map((unit) => ({ id: unit.id, name: unit.name, kind: unit.kind, label: asLabel(unit.name), item: null }))
  ];
  const active = all.filter((row) => !isMuted(row.id));
  const mutedRows = all.filter((row) => isMuted(row.id));
  const trailers = active.filter((row) => row.kind === "trailer").length;
  const trucks = active.filter((row) => row.kind === "truck").length;
  const other = active.length - trailers - trucks;

  const since = (iso: string) => {
    const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    return days ? `${days} day${days === 1 ? "" : "s"}${hours ? ` ${hours} hr` : ""} ago` : `${hours} hr ago`;
  };
  const stamp = (iso: string) => {
    const time = new Date(iso);
    return Number.isNaN(time.getTime()) ? "—" : time.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  };
  const box = "flex h-12 min-w-[110px] items-center justify-center rounded px-3 text-base font-black";
  const soft = darkMode ? "bg-red-500/20 text-white" : "bg-red-100 text-steel-900";

  return (
    <section className="mt-6">
      <div className="flex items-end justify-between gap-3 border-b-2 border-red-600 pb-2">
        <h3 className="text-2xl font-black uppercase">No GPS in 24 hours</h3>
        <span className={`shrink-0 text-base font-black ${muted}`}>
          {plural(active.length, "unit")}
          {mutedRows.length ? ` · ${mutedRows.length} muted` : ""}
        </span>
      </div>
      <div className={`mt-3 rounded border p-3 ${darkMode ? "border-white/10 bg-white/[0.03]" : "border-steel-100 bg-steel-50"}`}>
        <div className="flex flex-wrap items-center gap-2">
          <p className={`mr-auto text-sm font-bold ${muted}`}>The tracker may be unplugged, out of battery or out of signal.</p>
          <span className={`${box} ${soft}`}>{plural(trailers, "trailer")}</span>
          <span className={`${box} ${soft}`}>{plural(trucks, "truck")}</span>
          {other > 0 && <span className={`${box} ${soft}`}>{other} other</span>}
          <span className={`${box} bg-red-600 text-white`}>{active.length} total</span>
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[960px] border-collapse text-sm">
            <thead>
              <tr className="bg-steel-900 text-white">
                <th className="px-3 py-2.5 text-left font-black">Unit</th>
                <th className="px-3 py-2.5 text-left font-black">Full name</th>
                <th className="px-3 py-2.5 text-center font-black">Type</th>
                <th className="px-3 py-2.5 text-center font-black">Last GPS</th>
                <th className="px-3 py-2.5 text-center font-black">Last ping</th>
                <th className="px-3 py-2.5 text-left font-black">Last known spot</th>
                <th className="px-3 py-2.5 text-center font-black">Map</th>
                <th className="px-3 py-2.5 text-center font-black">Alert</th>
              </tr>
            </thead>
            <tbody>
              {active.map((row, index) => (
                <tr key={row.id} className={`border-t ${line} ${index % 2 ? (darkMode ? "bg-white/[0.03]" : "bg-steel-50") : darkMode ? "" : "bg-white"}`}>
                  <td className="px-3 py-2">
                    <span
                      className="rounded px-2 py-0.5 text-xs font-black text-white"
                      style={{ background: row.kind === "truck" ? "#2a6b40" : row.kind === "trailer" ? "#c2410c" : "#6c7a86" }}
                    >
                      {row.label}
                    </span>
                  </td>
                  <td className="max-w-[320px] truncate px-3 py-2 font-bold" title={row.name}>
                    {row.name}
                  </td>
                  <td className="px-3 py-2 text-center font-bold capitalize">{row.kind === "asset" ? "Other" : row.kind}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-center font-black text-red-600">{row.item ? since(row.item.time) : "Over 3 days"}</td>
                  <td className={`whitespace-nowrap px-3 py-2 text-center font-bold ${muted}`}>{row.item ? stamp(row.item.time) : "—"}</td>
                  <td className="max-w-[240px] truncate px-3 py-2 font-bold" title={row.item ? whereOf(row.item) : ""}>
                    {row.item ? whereOf(row.item) : <span className={muted}>Not known</span>}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {row.item ? (
                      <button
                        type="button"
                        onClick={() => row.item && onFocus(row.item)}
                        className={`mx-auto flex min-h-0 items-center gap-1 whitespace-nowrap rounded border px-2.5 py-1.5 text-xs font-black ${line} ${darkMode ? "hover:bg-white/10" : "bg-white hover:bg-steel-50"}`}
                      >
                        <MapPin size={12} /> Show last spot
                      </button>
                    ) : (
                      <span className={`text-xs font-bold ${muted}`}>—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <button
                      type="button"
                      onClick={() => onMute(row.id)}
                      title="Stop alerting on this unit for 7 days"
                      className={`mx-auto flex min-h-0 items-center gap-1 whitespace-nowrap rounded border px-2.5 py-1.5 text-xs font-black ${line} ${darkMode ? "hover:bg-white/10" : "bg-white hover:bg-steel-50"}`}
                    >
                      <BellOff size={12} /> Mute 7 days
                    </button>
                  </td>
                </tr>
              ))}
              {active.length === 0 && (
                <tr>
                  <td colSpan={8} className={`px-3 py-5 text-center text-sm font-bold ${muted}`}>
                    Every truck and trailer has sent GPS in the last 24 hours.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {mutedRows.length > 0 && (
          <div className={`mt-3 flex flex-wrap items-center gap-1.5 text-xs font-black ${muted}`}>
            <span>Muted:</span>
            {mutedRows.map((row) => (
              <span key={row.id} className={`flex items-center gap-1 rounded-full border py-1 pl-3 pr-1 ${line}`}>
                {row.label} · until {new Date(mutedUntil(row.id)).toLocaleDateString([], { month: "short", day: "numeric" })}
                <button
                  type="button"
                  onClick={() => onUnmute(row.id)}
                  title="Alert on this unit again"
                  className={`flex min-h-0 items-center gap-0.5 rounded-full px-2 py-0.5 ${darkMode ? "hover:bg-white/10" : "hover:bg-steel-100"}`}
                >
                  <Bell size={11} /> Unmute
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// The "Tamper" tab: trackers that went silent while their unit was moving,
// newest first. Checked events stay listed (greyed) so there's a record.
function TamperSection({
  events,
  isChecked,
  onCheck,
  whereOf,
  unitLabel,
  darkMode,
  onFocus
}: {
  events: FleetItem[];
  isChecked: (item: FleetItem) => boolean;
  onCheck: (item: FleetItem) => void;
  whereOf: (item: FleetItem) => string;
  unitLabel: (item: FleetItem) => string;
  darkMode: boolean;
  onFocus: (item: FleetItem) => void;
}) {
  const muted = darkMode ? "text-steel-100" : "text-steel-500";
  const line = darkMode ? "border-white/10" : "border-steel-100";
  const open = events.filter((item) => !isChecked(item));
  const stamp = (iso: string) => {
    const time = new Date(iso);
    return Number.isNaN(time.getTime()) ? "—" : time.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  };
  const small = `mx-auto flex min-h-0 items-center gap-1 whitespace-nowrap rounded border px-2.5 py-1.5 text-xs font-black ${line} ${
    darkMode ? "hover:bg-white/10" : "bg-white hover:bg-steel-50"
  }`;

  return (
    <section className="mt-6">
      <div className="flex items-end justify-between gap-3 border-b-2 border-red-700 pb-2">
        <h3 className="flex items-center gap-2 text-2xl font-black uppercase">
          <AlertTriangle size={22} className="text-red-600" /> Tamper alerts
        </h3>
        <span className={`shrink-0 text-base font-black ${muted}`}>
          {open.length} open{events.length > open.length ? ` · ${events.length - open.length} checked` : ""}
        </span>
      </div>
      <div className={`mt-3 rounded border p-3 ${darkMode ? "border-white/10 bg-white/[0.03]" : "border-steel-100 bg-steel-50"}`}>
        <p className={`text-sm font-bold ${muted}`}>
          The tracker&apos;s last report had the unit moving, then it went silent (trucks after 30 min, trailers after 2 hr). A normal stop
          reports 0 mph first — so this usually means the tracker was unplugged, cut or covered, or it&apos;s in a long dead zone. Check the
          unit, then mark it checked.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-sm">
            <thead>
              <tr className="bg-steel-900 text-white">
                <th className="px-3 py-2.5 text-left font-black">Unit</th>
                <th className="px-3 py-2.5 text-left font-black">Full name</th>
                <th className="px-3 py-2.5 text-center font-black">Type</th>
                <th className="px-3 py-2.5 text-center font-black">Last speed</th>
                <th className="px-3 py-2.5 text-center font-black">Went dark</th>
                <th className="px-3 py-2.5 text-left font-black">Last known spot</th>
                <th className="px-3 py-2.5 text-center font-black">Map</th>
                <th className="px-3 py-2.5 text-center font-black">Status</th>
              </tr>
            </thead>
            <tbody>
              {events.map((item, index) => {
                const done = isChecked(item);
                return (
                  <tr
                    key={item.id}
                    className={`border-t ${line} ${done ? "opacity-55" : ""} ${
                      !done ? (darkMode ? "bg-red-500/10" : "bg-red-50") : index % 2 ? (darkMode ? "bg-white/[0.03]" : "bg-steel-50") : darkMode ? "" : "bg-white"
                    }`}
                  >
                    <td className="px-3 py-2">
                      <span
                        className="rounded px-2 py-0.5 text-xs font-black text-white"
                        style={{ background: item.kind === "truck" ? "#2a6b40" : item.kind === "trailer" ? "#c2410c" : "#6c7a86" }}
                      >
                        {unitLabel(item)}
                      </span>
                    </td>
                    <td className="max-w-[300px] truncate px-3 py-2 font-bold" title={item.name}>
                      {item.name}
                    </td>
                    <td className="px-3 py-2 text-center font-bold capitalize">{item.kind === "asset" ? "Other" : item.kind}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-center font-black text-red-600">{Math.round(item.speedMph ?? 0)} mph</td>
                    <td className="whitespace-nowrap px-3 py-2 text-center font-bold">
                      <span className="font-black text-red-600">{ago(item.time)}</span>
                      <span className={`block text-[11px] ${muted}`}>{stamp(item.time)}</span>
                    </td>
                    <td className="max-w-[240px] truncate px-3 py-2 font-bold" title={whereOf(item)}>
                      {whereOf(item)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button type="button" onClick={() => onFocus(item)} className={small}>
                        <MapPin size={12} /> Show last spot
                      </button>
                    </td>
                    <td className="px-3 py-2 text-center">
                      {done ? (
                        <span className={`flex items-center justify-center gap-1 text-xs font-black ${muted}`}>
                          <Check size={12} /> Checked
                        </span>
                      ) : (
                        <button type="button" onClick={() => onCheck(item)} className={small}>
                          <Check size={12} /> Mark checked
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {events.length === 0 && (
                <tr>
                  <td colSpan={8} className={`px-3 py-5 text-center text-sm font-bold ${muted}`}>
                    No tamper alerts — no tracker has gone silent while its unit was moving.
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
