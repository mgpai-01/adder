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

      const baseColumns = "id, username, full_name, role, active";
      type ProfileRow = {
        id: string;
        username: string | null;
        full_name: string;
        role: string;
        active: boolean;
        manager_yard?: string | null;
      };
      let data: ProfileRow | null;
      let profileError: { message: string } | null;
      ({ data, error: profileError } = await withTimeoutRetry(
        () =>
          supabase
            .from("profiles")
            .select(`${baseColumns}, manager_yard`)
            .eq("id", user.id)
            .maybeSingle<ProfileRow>(),
        12000
      ));

      // The manager_yard column may not exist yet on older databases. Fall back
      // to the base columns so logins keep working before the migration is run.
      if (profileError && /manager_yard/i.test(profileError.message)) {
        ({ data, error: profileError } = await withTimeoutRetry(
          () => supabase.from("profiles").select(baseColumns).eq("id", user.id).maybeSingle<ProfileRow>(),
          12000
        ));
      }

      if (profileError) {
        setError(`Could not read your access: ${profileError.message}`);
        setProfile(null);
        return null;
      }
      if (!data) {
        setError("No profile row was found for this login. Ask an admin.");
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
        fullName: data.full_name,
        role: data.role as AppRole,
        active: data.active,
        allowedYards: (data.manager_yard ?? "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
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
        const { data } = await withTimeout(supabase.auth.getSession(), 8000);
        if (!active) return;
        window.sessionStorage.removeItem("mgp-auth-reset");
        if (data.session) {
          const restored = await loadProfile(data.session);
          // Admins must sign in fresh every page load — a restored session
          // (refresh/revisit) is never allowed to stay signed in, so an
          // unattended admin screen can't be reopened.
          if (restored?.role === "admin") {
            loadedUserId.current = "";
            clearStoredSession();
            await supabase.auth.signOut();
            setProfile(null);
            if (active) setLoading(false);
            return;
          }
        }
        if (active) setLoading(false);
      } catch {
        if (!active) return;
        // The stored session is jammed. Clear it and reload once to recover.
        if (!window.sessionStorage.getItem("mgp-auth-reset")) {
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

  // Admins are signed out after 5 minutes of inactivity so an unattended admin
  // screen can't be browsed by someone else. Any interaction resets the timer.
  useEffect(() => {
    if (profile?.role !== "admin") return;
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void signOut();
      }, 5 * 60 * 1000);
    };
    const events = ["pointerdown", "click", "keydown", "touchstart"];
    events.forEach((event) => window.addEventListener(event, reset, { passive: true }));
    reset();
    return () => {
      clearTimeout(timer);
      events.forEach((event) => window.removeEventListener(event, reset));
    };
  }, [profile?.role, signOut]);

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

// Which app views each role may open. Admin sees everything; Manager runs
// production and reports; Counter only handles count sheets.
export const roleViews: Record<AppRole, string[]> = {
  admin: ["entry", "count-sheets", "production-grid", "dashboard", "payroll", "cloud", "users", "settings"],
  supervisor: ["entry", "count-sheets", "production-grid"],
  employee: ["count-sheets"]
};

export const roleLabels: Record<AppRole, string> = {
  admin: "Admin",
  supervisor: "Manager",
  employee: "Counter"
};
