// Server-only: the yard alert. Watches MGP's production yards (lib/yards,
// `production: true` — Sultana, Merrill, Citrus) and alerts when one has had
// no trailers parked for 30 minutes.
//
// "Since when" has to outlive a single request, so it lives in the
// fleet_yard_watch table (supabase/fleet-yard-watch-migration.sql): a row is
// written when a yard first shows no trailers, its updated_at is the last time
// the yard was seen with none, and it's removed once trailers have been back
// for 3 minutes (BACK_FOR_MS).
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
// A trailer has to be back for this long before the timer is cleared, so one
// GPS reading of a trailer on the edge of the geofence (or a brief visit)
// doesn't restart the 30 minutes.
const BACK_FOR_MS = 3 * 60 * 1000;

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

const memory = new Map<string, { emptySince: string; lastEmpty: string }>();

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
  const rows = new Map<string, { emptySince: string; lastEmpty: string }>();
  if (supabase) {
    const { data, error } = await supabase
      .from("fleet_yard_watch")
      .select("yard_id, empty_since, updated_at")
      .in("yard_id", watched.map((yard) => yard.yardId));
    if (error) {
      storage = "memory";
      console.warn("Yard watch: fleet_yard_watch table unavailable, using memory:", error.message);
    } else {
      for (const row of data ?? []) rows.set(String(row.yard_id), { emptySince: String(row.empty_since), lastEmpty: String(row.updated_at) });
    }
  } else {
    storage = "memory";
  }
  if (storage === "memory") for (const [id, row] of memory) rows.set(id, row);

  // Empty now: start the timer if there isn't one, and note it's still empty.
  // Trailers now: clear the timer only once they've been back 3 minutes.
  const stillEmpty = watched.filter((yard) => yard.trailers === 0).map((yard) => yard.yardId);
  const cleared = watched
    .filter((yard) => yard.trailers > 0 && rows.has(yard.yardId))
    .filter((yard) => Date.now() - Date.parse(rows.get(yard.yardId)?.lastEmpty ?? now) >= BACK_FOR_MS)
    .map((yard) => yard.yardId);
  const saved = stillEmpty.map((id) => ({ yard_id: id, empty_since: rows.get(id)?.emptySince ?? now, updated_at: now }));
  for (const row of saved) rows.set(row.yard_id, { emptySince: row.empty_since, lastEmpty: now });
  for (const id of cleared) rows.delete(id);

  if (storage === "database" && supabase) {
    if (saved.length) {
      const { error } = await supabase.from("fleet_yard_watch").upsert(saved);
      if (error) console.warn("Yard watch: couldn't save:", error.message);
    }
    if (cleared.length) await supabase.from("fleet_yard_watch").delete().in("yard_id", cleared);
  } else {
    for (const row of saved) memory.set(row.yard_id, { emptySince: row.empty_since, lastEmpty: now });
    for (const id of cleared) memory.delete(id);
  }

  return {
    storage,
    checkedAt: now,
    yards: watched.map((yard) => {
      // While trailers are back but not yet for 3 minutes, the yard shows its
      // trailers (no "empty" line) — the timer is just kept in case they leave.
      const emptySince = yard.trailers === 0 ? rows.get(yard.yardId)?.emptySince ?? now : null;
      return { ...yard, emptySince, alert: Boolean(emptySince) && Date.now() - Date.parse(emptySince as string) >= YARD_EMPTY_ALERT_MS };
    })
  };
}
