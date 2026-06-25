import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Whether Supabase auth is configured. Evaluated at build time for the client
// because NEXT_PUBLIC_* values are inlined into the browser bundle.
export const isSupabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

let browserClient: SupabaseClient | null = null;

// Singleton browser client used for authentication (persists the session).
export function getBrowserSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  if (!browserClient) {
    browserClient = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        // By default supabase-js serializes auth calls across tabs with
        // navigator.locks. If one tab holds (or wedges) that lock, other tabs'
        // sign-in/getSession calls hang until they time out — which showed up as
        // "Slow connection" with two app tabs open. Use a pass-through lock so
        // each tab runs independently and can never block another.
        lock: async (_name, _acquireTimeout, fn) => fn()
      }
    });
  }

  return browserClient;
}

// A separate client for the password-reset page. It must read the recovery
// token Supabase puts in the URL (detectSessionInUrl), which the main client
// deliberately ignores. Uses its own storage key so it can't disturb a normal
// login session.
let resetClient: SupabaseClient | null = null;
export function getResetSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  if (!resetClient) {
    resetClient = createClient(url, anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: true,
        storageKey: "sb-mgp-reset",
        lock: async (_name, _acquireTimeout, fn) => fn()
      }
    });
  }

  return resetClient;
}

// Fire-and-forget pings that open the DNS/TLS connection and wake the auth
// server + database so they are hot by the time the user submits the login
// form. Safe to call repeatedly; only the first call does work.
let warmed = false;
export function warmupSupabase() {
  if (warmed || typeof fetch === "undefined") return;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return;
  warmed = true;
  const opts: RequestInit = {
    method: "GET",
    headers: { apikey: anonKey },
    cache: "no-store",
    keepalive: true
  };
  // Auth server handles signInWithPassword; REST root warms PostgREST + the DB
  // connection used by the profile lookup. Ignore all errors — this is a warmup.
  fetch(`${url}/auth/v1/health`, opts).catch(() => {});
  fetch(`${url}/rest/v1/`, opts).catch(() => {});
}
