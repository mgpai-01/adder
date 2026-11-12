"use client";

// Small client hooks for the Samsara fleet features, shared by the Fleet tab,
// its menu button and the Dashboard's Samsara panel.
import { useEffect, useState } from "react";
import { authedFetch } from "./auth";
import type { FleetItem } from "./samsara";
import type { YardWatch } from "./yardWatch";

// Whether this login may see the fleet features. The server decides
// (lib/previewAccess via /api/samsara/access); asked once per signed-in user.
export function useSamsaraAccess(profileId: string | undefined): boolean {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    if (!profileId) {
      setAllowed(false);
      return;
    }
    let cancelled = false;
    authedFetch("/api/samsara/access")
      .then((response) => response.json())
      .then((result: { allowed?: boolean }) => {
        if (!cancelled) setAllowed(Boolean(result.allowed));
      })
      .catch(() => {
        if (!cancelled) setAllowed(false);
      });
    return () => {
      cancelled = true;
    };
  }, [profileId]);
  return allowed;
}

// Live fleet status for the header: how many trucks / trailers are moving
// right now (over 2 mph) for the Fleet menu button, and the production yards'
// trailer watch for the yard alert bell (lib/yardWatch). Refreshed every
// minute; null until known. The server shares one Samsara pull per 30 s, so
// this costs no extra calls — and these refreshes are also what keep the
// yard watch's "empty since" times up to date.
const MOVING_MPH = 2;
export type FleetStatus = { moving: number | null; yardWatch: YardWatch[] | null; yardWatchSaved: boolean };
export function useFleetStatus(enabled: boolean): FleetStatus {
  const [status, setStatus] = useState<FleetStatus>({ moving: null, yardWatch: null, yardWatchSaved: true });
  useEffect(() => {
    if (!enabled) {
      setStatus({ moving: null, yardWatch: null, yardWatchSaved: true });
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const response = await authedFetch("/api/samsara/fleet");
        if (!response.ok) return;
        const result = (await response.json()) as { items?: FleetItem[]; yardWatch?: { yards?: YardWatch[]; storage?: string } | null };
        if (cancelled) return;
        setStatus((current) => ({
          moving: (result.items ?? []).filter((item) => (item.speedMph ?? 0) > MOVING_MPH).length,
          yardWatch: result.yardWatch?.yards ?? current.yardWatch,
          yardWatchSaved: result.yardWatch ? result.yardWatch.storage !== "memory" : current.yardWatchSaved
        }));
      } catch {
        // keep the last status on a blip
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [enabled]);
  return status;
}
