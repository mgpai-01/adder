"use client";

import { useEffect, useState } from "react";

// Matches the various ways a browser reports a failed JS chunk load — the
// telltale sign that an old tab is requesting assets a newer deploy removed.
const CHUNK_ERROR =
  /ChunkLoadError|Loading chunk [\w-]+ failed|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i;

// Reload at most once per window to recover from a stale chunk without ever
// getting stuck in a refresh loop if the error keeps firing.
function reloadOnce() {
  try {
    const last = Number(sessionStorage.getItem("skew-reload-at") || 0);
    if (Date.now() - last < 10_000) return;
    sessionStorage.setItem("skew-reload-at", String(Date.now()));
  } catch {
    // sessionStorage can be unavailable (private mode); fall through to reload.
  }
  window.location.reload();
}

// A free, code-side stand-in for Vercel's paid Skew Protection.
//   1. Recovers automatically when an open tab hits a chunk that a newer
//      deploy removed (asset 404 → reload to the current version).
//   2. Surfaces a gentle "refresh" prompt when a newer deploy is live, without
//      auto-reloading, so in-progress data entry is never lost.
export default function VersionGuard({ buildId }: { buildId: string }) {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    function onError(event: ErrorEvent) {
      const message = event?.message || event?.error?.message || "";
      if (CHUNK_ERROR.test(String(message))) reloadOnce();
    }
    function onRejection(event: PromiseRejectionEvent) {
      const reason = event?.reason;
      const message = typeof reason === "string" ? reason : reason?.message || "";
      if (CHUNK_ERROR.test(String(message))) reloadOnce();
    }
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  useEffect(() => {
    // Without a real commit id (e.g. local dev) there is nothing to compare.
    if (!buildId || buildId === "dev") return;
    let cancelled = false;

    async function check() {
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { buildId?: string };
        if (!cancelled && data.buildId && data.buildId !== buildId) {
          setStale(true);
        }
      } catch {
        // Offline or transient — try again on the next tick.
      }
    }

    function onVisible() {
      if (document.visibilityState === "visible") check();
    }

    document.addEventListener("visibilitychange", onVisible);
    const interval = window.setInterval(check, 5 * 60 * 1000);
    check();

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(interval);
    };
  }, [buildId]);

  if (!stale) return null;

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-50 flex justify-center px-3"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}
    >
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="touch-target flex items-center justify-center gap-2 rounded-xl bg-workshop-700 px-5 py-3 text-sm font-black text-white shadow-panel [animation:toast-in_0.3s_ease-out]"
      >
        A new version is available — tap to refresh
      </button>
    </div>
  );
}
