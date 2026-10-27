"use client";

import type { FleetItem } from "@/lib/samsara";
import type { YardArea } from "@/lib/yards";

// The Yard board under the fleet map: laid out like the Production Grid, but
// the columns are MGP's yards (plus "Not at a yard") instead of days, and each
// cell lists the trucks / trailers parked there right now. It's rebuilt from
// the live positions every refresh, so a trailer that moves from one yard to
// another moves to that yard's column.

const AWAY = "__away";

type Row = { key: string; label: string; sub: string; match: (item: FleetItem) => boolean };

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
  // Rows: trucks, then trailers by length (longest first), then the rest.
  const sizes = Array.from(new Set(items.filter((item) => item.kind === "trailer").map((item) => item.size)));
  sizes.sort((a, b) => (a === "" ? 1 : b === "" ? -1 : parseInt(b) - parseInt(a)));
  const rows: Row[] = [
    { key: "truck", label: "Trucks", sub: "", match: (item: FleetItem) => item.kind === "truck" },
    ...sizes.map((size) => ({
      key: `trailer-${size || "unlisted"}`,
      label: "Trailers",
      sub: size || "Size not listed",
      match: (item: FleetItem) => item.kind === "trailer" && item.size === size
    })),
    { key: "other", label: "Other", sub: "Yards, equipment, assets", match: (item: FleetItem) => item.kind !== "truck" && item.kind !== "trailer" }
  ].filter((row) => items.some(row.match));

  const columnOf = (item: FleetItem) => yardOf.get(item.id)?.id ?? AWAY;
  const columns = [...yards.map((yard) => ({ id: yard.id, yard })), { id: AWAY, yard: null as YardArea | null }];
  const cell = (row: Row, columnId: string) =>
    items.filter((item) => row.match(item) && columnOf(item) === columnId).sort((a, b) => unitLabel(a).localeCompare(unitLabel(b), undefined, { numeric: true }));

  const line = darkMode ? "border-white/10" : "border-steel-100";
  const muted = darkMode ? "text-steel-100" : "text-steel-500";
  const totalCell = darkMode ? "bg-workshop-700/40" : "bg-workshop-100";

  if (yards.length === 0) return null;

  return (
    <div className={`overflow-x-auto rounded border ${line}`}>
      <table className="w-full min-w-[760px] border-collapse text-sm">
        <thead>
          <tr className="bg-steel-900 text-white">
            <th className="px-3 py-3 text-left font-black">Yard board</th>
            {columns.map(({ id, yard }) => (
              <th key={id} className="px-3 py-2 text-center align-bottom">
                {yard ? (
                  <button type="button" onClick={() => onZoomYard(yard)} className="font-black hover:underline" title={`Show ${yard.name} on the map`}>
                    {yard.name}
                  </button>
                ) : (
                  <span className="font-black">Not at a yard</span>
                )}
                <span className="block text-[11px] font-black uppercase tracking-wide text-safety-400">
                  {yard ? (yard.placeName ? `Geofence: ${yard.placeName}` : "250 m around address") : "On the road / elsewhere"}
                </span>
              </th>
            ))}
            <th className="bg-safety-400 px-3 py-3 text-center font-black text-steel-900">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const total = items.filter(row.match).length;
            return (
              <tr key={row.key} className={`border-t ${line} ${index % 2 ? (darkMode ? "bg-white/[0.03]" : "bg-steel-50") : ""}`}>
                <td className="px-3 py-2.5 align-top">
                  <span className="block font-black">{row.label}</span>
                  {row.sub && <span className={`block text-xs font-bold ${muted}`}>{row.sub}</span>}
                </td>
                {columns.map(({ id }) => {
                  const units = cell(row, id);
                  return (
                    <td key={id} className="px-3 py-2.5 text-center align-top">
                      {units.length === 0 ? (
                        <span className={muted}>—</span>
                      ) : (
                        <>
                          <span className="block font-black">{units.length}</span>
                          <span className="mt-1 flex flex-wrap justify-center gap-1">
                            {units.map((item) => (
                              <button
                                key={item.id}
                                type="button"
                                onClick={() => onFocus(item)}
                                title={`${item.name} — show on map`}
                                className="min-h-0 rounded-full bg-steel-800 px-2 py-0.5 text-[11px] font-black leading-4 text-white hover:bg-steel-900"
                              >
                                {unitLabel(item)}
                              </button>
                            ))}
                          </span>
                        </>
                      )}
                    </td>
                  );
                })}
                <td className={`px-3 py-2.5 text-center align-top font-black ${totalCell}`}>{total}</td>
              </tr>
            );
          })}
          <tr className={`border-t-2 ${darkMode ? "border-white/30" : "border-steel-900"} ${totalCell}`}>
            <td className="px-3 py-3 font-black">Totals</td>
            {columns.map(({ id }) => (
              <td key={id} className="px-3 py-3 text-center font-black">
                {items.filter((item) => columnOf(item) === id).length}
              </td>
            ))}
            <td className="px-3 py-3 text-center font-black">{items.length}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
