"use client";

import type { FleetItem } from "@/lib/samsara";
import type { YardArea } from "@/lib/yards";

// The Yard board under the fleet map: one card per yard (plus "Not at a
// yard"), each showing the trucks and trailers parked there right now as
// compact tags — trucks first, then trailers grouped by length. It's rebuilt from the live
// positions on every refresh, so a trailer that moves from one yard to
// another moves to that yard's card.

const YARD_COLOR = "#7c3aed";
const TRUCK_COLOR = "#2a6b40";
const TRAILER_COLOR = "#c2410c";
const OTHER_COLOR = "#6c7a86";

function ago(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} hr ago` : `${Math.round(hours / 24)} days ago`;
}

export default function YardBoard({
  items,
  yards,
  yardOf,
  unitLabel,
  darkMode,
  onFocus,
  onZoomYard
}: {
  items: FleetItem[];
  yards: YardArea[];
  yardOf: Map<string, YardArea>;
  unitLabel: (item: FleetItem) => string;
  darkMode: boolean;
  onFocus: (item: FleetItem) => void;
  onZoomYard: (yard: YardArea) => void;
}) {
  if (yards.length === 0) return null;

  const byLabel = (a: FleetItem, b: FleetItem) => unitLabel(a).localeCompare(unitLabel(b), undefined, { numeric: true });
  const cards = [
    ...yards.map((yard) => ({ key: yard.id, yard, units: items.filter((item) => yardOf.get(item.id)?.id === yard.id) })),
    { key: "away", yard: null as YardArea | null, units: items.filter((item) => !yardOf.has(item.id)) }
  ];

  const card = darkMode ? "border-white/10 bg-white/[0.04]" : "border-steel-100 bg-white shadow-panel";
  const muted = darkMode ? "text-steel-100" : "text-steel-500";

  // Units as small tags that wrap side by side, so a yard with 20 trailers
  // takes a few lines, not 20 rows — the whole board fits on one screen.
  // Hover / long-press for the full name and last report; tap to find it.
  function UnitTag({ item, color }: { item: FleetItem; color: string }) {
    const moving = item.speedMph !== null && item.speedMph > 2;
    const status = moving ? `${Math.round(item.speedMph ?? 0)} mph` : `parked · ${ago(item.time)}`;
    return (
      <button
        type="button"
        onClick={() => onFocus(item)}
        title={`${item.name} — ${status}. Tap to show on map.`}
        className="relative min-h-0 rounded px-1.5 py-0.5 text-[11px] font-black leading-4 text-white transition hover:brightness-110"
        style={{ background: color }}
      >
        {unitLabel(item)}
        {moving && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border border-white bg-safety-500" />}
      </button>
    );
  }

  function Group({ title, color, units }: { title: string; color: string; units: FleetItem[] }) {
    if (units.length === 0) return null;
    return (
      <div className="flex items-start gap-2">
        <p className="w-14 shrink-0 pt-0.5 text-[10px] font-black uppercase leading-4 tracking-wide" style={{ color }}>
          {title}
          <span className={`block ${muted}`}>{units.length}</span>
        </p>
        <div className="flex min-w-0 flex-1 flex-wrap gap-1">
          {units.map((item) => (
            <UnitTag key={item.id} item={item} color={color} />
          ))}
        </div>
      </div>
    );
  }

  return (
    // One column per card on wide screens (yards + "Not at a yard"), so
    // adding a yard in lib/yards just adds a card.
    <div
      className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:[grid-template-columns:repeat(var(--yard-cards),minmax(0,1fr))]"
      style={{ ["--yard-cards" as string]: cards.length }}
    >
      {cards.map(({ key, yard, units }) => {
        const trucks = units.filter((item) => item.kind === "truck").sort(byLabel);
        const trailers = units.filter((item) => item.kind === "trailer");
        const others = units.filter((item) => item.kind !== "truck" && item.kind !== "trailer").sort(byLabel);
        // Trailers grouped by length, longest first; unknown length last.
        const sizes = Array.from(new Set(trailers.map((item) => item.size))).sort((a, b) =>
          a === "" ? 1 : b === "" ? -1 : parseInt(b) - parseInt(a)
        );
        const accent = yard ? YARD_COLOR : OTHER_COLOR;
        return (
          <section key={key} className={`flex flex-col overflow-hidden rounded border ${card}`}>
            <header className="border-t-4 px-3 pb-2 pt-2" style={{ borderTopColor: accent }}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  {yard ? (
                    <button
                      type="button"
                      onClick={() => onZoomYard(yard)}
                      className="min-h-0 truncate text-left text-base font-black hover:underline"
                      title={`Show ${yard.name} on the map`}
                    >
                      {yard.name}
                    </button>
                  ) : (
                    <p className="text-base font-black">Not at a yard</p>
                  )}
                  <p className={`truncate text-[11px] font-bold ${muted}`}>
                    {yard ? (yard.placeName ? `Geofence: ${yard.placeName}` : "250 m around the address") : "On the road or elsewhere"}
                  </p>
                </div>
                <span className="shrink-0 text-2xl font-black leading-none" style={{ color: accent }}>
                  {units.length}
                </span>
              </div>
              <p className={`mt-1 text-xs font-black ${muted}`}>
                {trucks.length} truck{trucks.length === 1 ? "" : "s"} · {trailers.length} trailer{trailers.length === 1 ? "" : "s"}
                {others.length ? ` · ${others.length} other` : ""}
              </p>
            </header>
            <div className={`grid flex-1 grid-cols-[minmax(0,1fr)] content-start gap-1.5 border-t px-3 py-2 ${darkMode ? "border-white/10" : "border-steel-100"}`}>
              {units.length === 0 ? (
                <p className={`py-1 text-center text-xs font-bold ${muted}`}>Nothing here right now</p>
              ) : (
                <>
                  <Group title="Trucks" color={TRUCK_COLOR} units={trucks} />
                  {sizes.map((size) => (
                    <Group
                      key={size || "unlisted"}
                      title={size || "Trailers"}
                      color={TRAILER_COLOR}
                      units={trailers.filter((item) => item.size === size).sort(byLabel)}
                    />
                  ))}
                  <Group title="Other" color={OTHER_COLOR} units={others} />
                </>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
