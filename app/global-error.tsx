"use client";

import { useEffect } from "react";

// Last-resort boundary for errors thrown in the root layout/providers. It must
// render its own <html>/<body>. Like app/error.tsx, it auto-reloads once on a
// stale-chunk error (common right after a deploy) and otherwise shows the real
// message with a reset option.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const isChunkError =
    error.name === "ChunkLoadError" ||
    /Loading chunk|Loading CSS chunk|dynamically imported module|Importing a module script failed/i.test(error.message ?? "");

  useEffect(() => {
    if (!isChunkError) return;
    const key = "mgp-chunk-reload";
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
    window.location.reload();
  }, [isChunkError]);

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#0f1f17", color: "white" }}>
        <main style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 24, fontWeight: 900 }}>{isChunkError ? "Updating to the latest version…" : "Something went wrong"}</h1>
          {!isChunkError && error?.message && (
            <pre style={{ maxWidth: 480, overflow: "auto", borderRadius: 8, background: "rgba(0,0,0,0.4)", padding: 12, textAlign: "left", fontSize: 12, color: "#fecaca" }}>{error.message}</pre>
          )}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
            <button
              type="button"
              onClick={() => {
                sessionStorage.removeItem("mgp-chunk-reload");
                reset();
              }}
              style={{ borderRadius: 12, background: "#2f9e54", color: "white", fontWeight: 900, padding: "12px 20px", border: "none" }}
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => {
                try {
                  sessionStorage.clear();
                  localStorage.clear();
                } catch {
                  // ignore
                }
                window.location.href = "/";
              }}
              style={{ borderRadius: 12, background: "transparent", color: "white", fontWeight: 900, padding: "12px 20px", border: "1px solid rgba(255,255,255,0.3)" }}
            >
              Reset &amp; reload
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
