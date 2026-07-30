"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { getBrowserSupabase, isSupabaseConfigured, warmupSupabase } from "./supabaseBrowser";

export type AppRole = "admin" | "supervisor" | "employee";

export type Profile = {
  id: string;
  username: string;
  fullName: string;
  role: AppRole;
  active: boolean;
  // Yards a Manager is allowed to view (empty = all yards). Only meaningful for
  // the "supervisor" role. Stored in profiles.manager_yard as a comma list.
  allowedYards: string[];
  // Saved UI language preference ("en" | "es"); empty means none saved yet, so
  // the role default applies. Stored in profiles.preferred_language.
  preferredLanguage: "" | "en" | "es";
};

type AuthState = {
  configured: boolean;
  loading: boolean;
  profile: Profile | null;
  error: string;
  signIn: (identifier: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  // Emails a password-reset link to the address on the account. Returns an
  // error message string, or "" on success.
  requestPasswordReset: (email: string) => Promise<string>;
};

const AuthContext = createContext<AuthState | null>(null);

// Staff sign in with a simple username; admins can use their real email. If the
// value has no "@", we attach the hidden internal domain so Supabase is happy.
function toEmail(identifier: string): string {
  const value = identifier.trim();
  return value.includes("@") ? value : `${value.toLowerCase()}@mgp.local`;
}

// Reject if a network call takes too long, so a weak connection surfaces a
// clear message instead of hanging the UI forever.
function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
  return Promise.race([
    promise as Promise<T>,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timed out")), ms))
  ]);
}

// Run an operation, retrying once if it times out. A paused (free-tier) database
// can take a while to cold-start, so the first attempt may be slow while the
// retry succeeds once it has woken up.
async function withTimeoutRetry<T>(factory: () => PromiseLike<T>, ms: number): Promise<T> {
  try {
    return await withTimeout(factory(), ms);
  } catch (caught) {
    if ((caught as Error)?.message !== "timed out") throw caught;
    return withTimeout(factory(), ms);
  }
}

// Wipe Supabase's stored auth session. A corrupted/locked session can make the
// auth client hang; clearing it and reloading recovers cleanly.
export function clearStoredSession() {
  try {
    Object.keys(window.localStorage)
      .filter((key) => key.startsWith("sb-"))
      .forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // ignore storage access issues
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const supabase = getBrowserSupabase();
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState("");
  // The user id whose profile is currently loaded. Used to skip duplicate
  // profile fetches (e.g. the SIGNED_IN auth event that fires right after we
  // already loaded the profile during sign-in, or hourly token refreshes).
  const loadedUserId = useRef("");

  // Load the signed-in user's profile. Pass the session from sign-in/getSession
  // to skip an extra getSession round trip; omit it to look the session up.
  const loadProfile = useCallback(async (knownSession?: Session | null): Promise<Profile | null> => {
    if (!supabase) return null;
    try {
      let session = knownSession;
      if (session === undefined) {
        const { data: sessionData } = await supabase.auth.getSession();
        session = sessionData.session;
      }
      setCachedAccessToken(session?.access_token ?? "");
      const user = session?.user;
      if (!user) {
        loadedUserId.current = "";
        setProfile(null);
        return null;
      }
      loadedUserId.current = user.id;

      // Read the profile through the server (service-role) endpoint rather than
      // querying the profiles table directly from the browser. The direct read
      // depends on the browser request carrying the freshly-issued auth token;
      // when it races ahead of the token it lands as the anon role and fails
      // with "permission denied for table profiles". The server validates the
      // token and reads with the service-role key, so it is not subject to that
      // race or to row-level-security rules.
      type MeResponse = {
        reason?: string;
        profile?: {
          id: string;
          username: string | null;
          fullName: string;
          role: string;
          active: boolean;
          managerYard?: string | null;
          preferredLanguage?: string | null;
        } | null;
      };
      const response = await withTimeoutRetry(
        () =>
          fetch("/api/auth/me", {
            headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
            cache: "no-store"
          }),
        12000
      );
      if (!response.ok) {
        setError(`Could not read your access (HTTP ${response.status}). Please try again.`);
        setProfile(null);
        return null;
      }
      const body = (await response.json()) as MeResponse;
      const data = body.profile ?? null;
      if (!data) {
        setError(
          body.reason
            ? `No profile found (${body.reason}). Ask an admin.`
            : "No profile row was found for this login. Ask an admin."
        );
        setProfile(null);
        return null;
      }
      if (!data.active) {
        setError("This account is inactive. Ask an admin to reactivate it.");
        setProfile(null);
        await supabase.auth.signOut();
        return null;
      }

      const loaded: Profile = {
        id: data.id,
        username: data.username ?? "",
        fullName: data.fullName,
        role: data.role as AppRole,
        active: data.active,
        allowedYards: (data.managerYard ?? "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        preferredLanguage: data.preferredLanguage === "en" || data.preferredLanguage === "es" ? data.preferredLanguage : ""
      };
      setProfile(loaded);
      setError("");
      return loaded;
    } catch (caught) {
      const message = (caught as Error)?.message ?? "unknown";
      setError(message === "timed out" ? "Slow connection — please try again." : `Login error: ${message}`);
      setProfile(null);
      return null;
    }
  }, [supabase]);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    let active = true;

    // Open the connection to Supabase immediately so it is hot before the user
    // submits the login form.
    warmupSupabase();

    (async () => {
      try {
        // getSession reads local storage but may try to refresh a stored token;
        // a corrupted/locked session hangs here, so cap it.
        // Retry once: a paused free-tier database can take a while to cold-start,
        // so the first read may be slow while the second succeeds.
        const { data } = await withTimeoutRetry(() => supabase.auth.getSession(), 8000);
        if (!active) return;
        window.sessionStorage.removeItem("mgp-auth-reset");
        if (data.session) {
          // Keep the session across page loads / navigating to the live board
          // and back. Unattended admin screens are protected by the inactivity
          // timeout below instead of forcing a fresh login every page load.
          await loadProfile(data.session);
        }
        if (active) setLoading(false);
      } catch (caught) {
        if (!active) return;
        // A slow answer is not a broken session. Wiping the stored tokens here
        // signed people out mid-shift whenever the database was cold or the
        // yard's connection was weak — which read as the inactivity timeout
        // firing early, even though that is a separate 15-minute timer. Keep
        // the session on a timeout and let onAuthStateChange restore the
        // profile once Supabase answers; only a genuinely jammed session
        // (a real error, not a slow one) is cleared, and only once per tab.
        const timedOut = (caught as Error)?.message === "timed out";
        if (!timedOut && !window.sessionStorage.getItem("mgp-auth-reset")) {
          window.sessionStorage.setItem("mgp-auth-reset", "1");
          clearStoredSession();
          window.location.reload();
          return;
        }
        setLoading(false);
      }
    })();

    const { data: subscription } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setCachedAccessToken(session?.access_token ?? "");
      if (!session) {
        loadedUserId.current = "";
        setProfile(null);
        return;
      }
      // Skip refetching when we already have this user's profile — avoids a
      // duplicate query on the SIGNED_IN event after sign-in and on token
      // refreshes (which keep the same user).
      if (session.user.id === loadedUserId.current) return;
      await loadProfile(session);
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [supabase, loadProfile]);

  const signIn = useCallback(
    async (identifier: string, password: string) => {
      if (!supabase) return;
      setError("");
      try {
        const { data, error: signInError } = await withTimeoutRetry(
          () => supabase.auth.signInWithPassword({ email: toEmail(identifier), password }),
          15000
        );
        if (signInError || !data.session) {
          setError("Wrong username/email or password.");
          throw signInError ?? new Error("Sign in failed.");
        }
        setCachedAccessToken(data.session.access_token);
        await loadProfile(data.session);
      } catch (caught) {
        if ((caught as Error)?.message === "timed out") {
          setError("Slow connection — please try again.");
        }
        throw caught;
      }
    },
    [supabase, loadProfile]
  );

  const signOut = useCallback(async () => {
    setCachedAccessToken("");
    await supabase?.auth.signOut();
    setProfile(null);
  }, [supabase]);

  // Auto sign-out an admin after 15 minutes of no activity, so an unattended
  // admin screen locks itself — without forcing a fresh login every time they
  // navigate (e.g. to the live board and back). ANY interaction — scrolling,
  // moving the mouse, typing, tapping — resets the timer, so it only fires when
  // the screen is genuinely idle.
  useEffect(() => {
    if (!profile || profile.role !== "admin") return;
    const TIMEOUT_MS = 15 * 60 * 1000;
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void signOut();
      }, TIMEOUT_MS);
    };
    // touchmove/pointermove matter on the yard tablets, where a long scroll is
    // one touchstart followed by movement. Listening in the capture phase makes
    // scrolling inside a pane count too — scroll events don't bubble, so a
    // window-only listener missed every inner scroll container and the screen
    // looked idle while someone was reading it.
    const activityEvents = ["mousemove", "mousedown", "keydown", "touchstart", "touchmove", "pointerdown", "pointermove", "scroll", "click", "wheel"];
    activityEvents.forEach((event) => window.addEventListener(event, reset, { passive: true, capture: true }));
    const onVisible = () => {
      if (document.visibilityState === "visible") reset();
    };
    document.addEventListener("visibilitychange", onVisible);
    reset();
    return () => {
      clearTimeout(timer);
      activityEvents.forEach((event) => window.removeEventListener(event, reset, { capture: true }));
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [profile, signOut]);

  const requestPasswordReset = useCallback(
    async (email: string): Promise<string> => {
      if (!supabase) return "Sign-in is not configured.";
      const value = email.trim();
      // Resets need a real inbox; usernames map to an internal, undeliverable
      // address, so require an actual email here.
      if (!value.includes("@")) {
        return "Enter the email address on your account.";
      }
      const redirectTo =
        typeof window !== "undefined" ? `${window.location.origin}/reset-password` : undefined;
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(value, { redirectTo });
      // Supabase returns success even when the email is unknown (so addresses
      // can't be probed); only surface real transport errors.
      if (resetError) return resetError.message;
      return "";
    },
    [supabase]
  );

  return (
    <AuthContext.Provider
      value={{ configured: isSupabaseConfigured, loading, profile, error, signIn, signOut, requestPasswordReset }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) {
    return {
      configured: false,
      loading: false,
      profile: null,
      error: "",
      signIn: async () => undefined,
      signOut: async () => undefined,
      requestPasswordReset: async () => "Sign-in is not configured."
    };
  }
  return context;
}

// The provider caches the current token here so admin API calls can read it
// instantly without re-calling getSession (which can stall).
let cachedAccessToken = "";

export function setCachedAccessToken(token: string) {
  cachedAccessToken = token;
}

// Current session token, for authenticating admin API calls from the browser.
export function getAccessToken(): string {
  return cachedAccessToken;
}

// fetch() with the caller's session attached. The API routes run with the
// service-role key (which bypasses row level security), so they check the
// session themselves — any call that changes rates, payroll settings, the
// roster or deletes records has to go through this rather than plain fetch.
export function authedFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = getAccessToken();
  return fetch(url, {
    ...options,
    headers: {
      ...(options.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  });
}

// Which app views each role may open. Admin sees everything; Manager runs
// production and reports; Counter only handles count sheets.
export const roleViews: Record<AppRole, string[]> = {
  admin: ["entry", "count-sheets", "production-grid", "dashboard", "live-yards", "payroll", "cloud", "users", "settings"],
  supervisor: ["entry", "count-sheets", "production-grid"],
  employee: ["count-sheets"]
};

export const roleLabels: Record<AppRole, string> = {
  admin: "Admin",
  supervisor: "Manager",
  employee: "Counter"
};
