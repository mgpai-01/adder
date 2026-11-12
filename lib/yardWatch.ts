// Server-only: the yard alert. Watches MGP's production yards (lib/yards,
// `production: true` — Sultana, Merrill, Citrus) and alerts when one has had
// no trailers parked for 30 minutes.
//
// "Since when" has to outlive a single request, so it lives in the
// fleet_yard_watch table (supabase/fleet-yard-watch-migration.sql): a row is
// written when a yard first shows no trailers and removed when one is back.
// It's updated whenever the server pulls fresh Samsara data — about once a
// minute while any admin has the app open (the Fleet menu button refreshes
// its count every minute, on every page). If the table hasn't been created
// yet, this server's memory is used instead, which can reset on a redeploy.
import type { SupabaseClient } from "@supabase/supabase-js";
import { insideGeofence } from "./geo";
import type { FleetItem } from "./samsara";
import { resolveYardAreas } from "./yardAreas";
import { YARDS } from "./yards";

export const YARD_EMPTY_ALERT_MS = 30 * 60 * 1000;

export type YardWatch = {
  yardId: string;
  name: string;
  trailers: number;
  trucks: number;
  // When the yard last ran out of trailers (ISO), or null while it has some.
  emptySince: string | null;
  // No trailers for 30 minutes or more.
  alert: boolean;
};

export type YardWatchResult = { yards: YardWatch[]; storage: "database" | "memory"; checkedAt: string };

const memory = new Map<string, string>();

export async function updateYardWatch(supabase: SupabaseClient | null, items: FleetItem[]): Promise<YardWatchResult | null> {
  // No trailers anywhere means the Samsara lookup failed, not that every yard
  // emptied at once — don't start (or reset) any timers on that.
  if (!items.some((item) => item.kind === "trailer")) return null;

  const { yards } = await resolveYardAreas();
  // Same rule as the Yard board: a unit counts at the first yard it's inside.
  const counts = new Map<string, { trailers: number; trucks: number }>();
  for (const item of items) {
    const yard = yards.find((area) => insideGeofence(area, item.lat, item.lng, 250));
    if (!yard) continue;
    const row = counts.get(yard.id) ?? { trailers: 0, trucks: 0 };
    if (item.kind === "trailer") row.trailers += 1;
    if (item.kind === "truck") row.trucks += 1;
    counts.set(yard.id, row);
  }

  const watched = YARDS.filter((yard) => yard.production).map((yard) => ({
    yardId: yard.id,
    name: yards.find((area) => area.id === yard.id)?.name ?? yard.name,
    ...(counts.get(yard.id) ?? { trailers: 0, trucks: 0 })
  }));
  const now = new Date().toISOString();

  // Since-when, from the table (or memory if it isn't there yet).
  let storage: YardWatchResult["storage"] = "database";
  const since = new Map<string, string>();
  if (supabase) {
    const { data, error } = await supabase.from("fleet_yard_watch").select("yard_id, empty_since").in("yard_id", watched.map((yard) => yard.yardId));
    if (error) storage = "memory";
    else for (const row of data ?? []) since.set(String(row.yard_id), String(row.empty_since));
  } else {
    storage = "memory";
  }
  if (storage === "memory") for (const [id, at] of memory) since.set(id, at);

  const emptied = watched.filter((yard) => yard.trailers === 0 && !since.has(yard.yardId)).map((yard) => yard.yardId);
  const refilled = watched.filter((yard) => yard.trailers > 0 && since.has(yard.yardId)).map((yard) => yard.yardId);
  for (const id of emptied) since.set(id, now);
  for (const id of refilled) since.delete(id);

  if (storage === "database" && supabase) {
    if (emptied.length) await supabase.from("fleet_yard_watch").upsert(emptied.map((yard_id) => ({ yard_id, empty_since: now, updated_at: now })));
    if (refilled.length) await supabase.from("fleet_yard_watch").delete().in("yard_id", refilled);
  } else {
    for (const id of emptied) memory.set(id, now);
    for (const id of refilled) memory.delete(id);
  }

  return {
    storage,
    checkedAt: now,
    yards: watched.map((yard) => {
      const emptySince = yard.trailers === 0 ? since.get(yard.yardId) ?? now : null;
      return { ...yard, emptySince, alert: Boolean(emptySince) && Date.now() - Date.parse(emptySince as string) >= YARD_EMPTY_ALERT_MS };
    })
  };
}
