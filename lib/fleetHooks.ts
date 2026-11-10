"use client";

// Small client hooks for the Samsara fleet features, shared by the Fleet tab,
// its menu button and the Dashboard's Samsara panel.
import { useEffect, useState } from "react";
import { authedFetch } from "./auth";
import type { FleetItem } from "./samsara";

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

// How many trucks / trailers are moving right now (over 2 mph), for the live
// count on the Fleet menu button. Refreshed every minute; null until known.
// The server shares one Samsara pull per 30 s, so this costs no extra calls.
const MOVING_MPH = 2;
export function useFleetMovingCount(enabled: boolean): number | null {
  const [moving, setMoving] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled) {
      setMoving(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const response = await authedFetch("/api/samsara/fleet");
        if (!response.ok) return;
        const result = (await response.json()) as { items?: FleetItem[] };
        if (!cancelled) setMoving((result.items ?? []).filter((item) => (item.speedMph ?? 0) > MOVING_MPH).length);
      } catch {
        // keep the last count on a blip
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [enabled]);
  return moving;
}
