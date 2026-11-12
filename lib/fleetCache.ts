// Server-only: one shared Samsara pull per 30 seconds, used by the Fleet map
// (/api/samsara/fleet) and the every-minute yard check
// (/api/samsara/yard-watch). Each fresh pull also updates the yard alert's
// timers (lib/yardWatch), so they keep running even with nobody on the site.
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchFleetSnapshot, type FleetSnapshot } from "./samsara";
import { updateYardWatch, type YardWatchResult } from "./yardWatch";

const CACHE_MS = 30_000;
export type FleetStatusCache = { at: number; snapshot: FleetSnapshot; yardWatch: YardWatchResult | null };
let cached: FleetStatusCache | null = null;
let pending: Promise<FleetStatusCache> | null = null;

export async function getFleetStatus(supabase: SupabaseClient | null): Promise<FleetStatusCache> {
  if (cached && Date.now() - cached.at <= CACHE_MS) return cached;
  // Callers arriving together share one pull.
  if (!pending) {
    pending = (async () => {
      const snapshot = await fetchFleetSnapshot();
      // A yard-watch failure must not take the map down with it.
      const yardWatch = await updateYardWatch(supabase, snapshot.items).catch((error) => {
        console.warn("Yard watch failed:", error instanceof Error ? error.message : error);
        return cached?.yardWatch ?? null;
      });
      const fresh: FleetStatusCache = { at: Date.now(), snapshot, yardWatch };
      cached = fresh;
      return fresh;
    })().finally(() => {
      pending = null;
    });
  }
  return pending;
}
