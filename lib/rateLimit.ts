// A simple per-user limit on how often a costly route can be called (each
// ETA is ~5 paid TomTom lookups; traffic images are paid per tile). Counts
// live in this server instance's memory, so it's a brake on runaway use, not
// an exact quota — Vercel may run more than one instance.

const hits = new Map<string, number[]>();

// True when `key` may make another call: at most `limit` calls in the last
// `windowMs`. Records the call when allowed.
export function allowCall(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((at) => now - at < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  // Keep memory bounded: drop users with nothing recent.
  if (hits.size > 2000) {
    for (const [entry, times] of hits) if (!times.some((at) => now - at < windowMs)) hits.delete(entry);
  }
  return true;
}
