"use client";

import { useEffect } from "react";

// Catches render/runtime errors in the app so the user sees a readable message
// and a way out instead of the browser's blank "Application error" screen.
//
// The most common cause right after a deploy is a stale chunk: the phone still
// has the previous build's HTML, which points at JS files the new deploy
// replaced. That surfaces as a ChunkLoadError. We auto-reload once (guarded so
// it can't loop) to pull the fresh build.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const isChunkError =
    error.name === "ChunkLoadError" ||
    /Loading chunk|Loading CSS chunk|dynamically imported module|Importing a module script failed/i.test(error.message ?? "");

  useEffect(() => {
    if (!isChunkError) return;
    const key = "mgp-chunk-reload";
    if (sessionStorage.getItem(key)) return; // already tried once — don't loop
    sessionStorage.setItem(key, "1");
    window.location.reload();
  }, [isChunkError]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-steel-900 p-6 text-center text-white">
      <h1 className="text-2xl font-black">{isChunkError ? "Updating to the latest version…" : "Something went wrong"}</h1>
      <p className="max-w-md text-sm text-steel-100">
        {isChunkError
          ? "A new version was just released. Reloading to get it…"
          : "The app hit an error. Try reloading. If it keeps happening, tap “Reset & reload”."}
      </p>
      {!isChunkError && error?.message && (
        <pre className="max-w-md overflow-auto rounded bg-black/40 p-3 text-left text-xs text-red-200">{error.message}</pre>
      )}
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => {
            sessionStorage.removeItem("mgp-chunk-reload");
            reset();
          }}
          className="rounded-xl bg-workshop-500 px-5 py-3 font-black text-white"
        >
          Try again
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-xl border border-white/30 px-5 py-3 font-black text-white"
        >
          Reload
        </button>
        <button
          type="button"
          onClick={() => {
            try {
              sessionStorage.clear();
              localStorage.clear();
            } catch {
              // ignore storage access errors
            }
            window.location.href = "/";
          }}
          className="rounded-xl border border-white/30 px-5 py-3 font-black text-white"
        >
          Reset &amp; reload
        </button>
      </div>
    </main>
  );
}
