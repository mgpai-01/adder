"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { getBrowserSupabase, isSupabaseConfigured } from "./supabaseBrowser";

export type AppRole = "admin" | "supervisor" | "employee";

export type Profile = {
  id: string;
  username: string;
  fullName: string;
  role: AppRole;
  active: boolean;
};

type AuthState = {
  configured: boolean;
  loading: boolean;
  profile: Profile | null;
  error: string;
  signIn: (identifier: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
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

  const loadProfile = useCallback(async () => {
    if (!supabase) return;
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      setCachedAccessToken(sessionData.session?.access_token ?? "");
      const user = sessionData.session?.user;
      if (!user) {
        setProfile(null);
        return;
      }

      const { data, error: profileError } = await withTimeoutRetry(
        () =>
          supabase
            .from("profiles")
            .select("id, username, full_name, role, active")
            .eq("id", user.id)
            .maybeSingle(),
        12000
      );

      if (profileError) {
        setError(`Could not read your access: ${profileError.message}`);
        setProfile(null);
        return;
      }
      if (!data) {
        setError("No profile row was found for this login. Ask an admin.");
        setProfile(null);
        return;
      }
      if (!data.active) {
        setError("This account is inactive. Ask an admin to reactivate it.");
        setProfile(null);
        await supabase.auth.signOut();
        return;
      }

      setProfile({
        id: data.id,
        username: data.username ?? "",
        fullName: data.full_name,
        role: data.role as AppRole,
        active: data.active
      });
      setError("");
    } catch (caught) {
      const message = (caught as Error)?.message ?? "unknown";
      setError(message === "timed out" ? "Slow connection — please try again." : `Login error: ${message}`);
      setProfile(null);
    }
  }, [supabase]);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    let active = true;

    (async () => {
      try {
        // getSession reads local storage but may try to refresh a stored token;
        // a corrupted/locked session hangs here, so cap it.
        const { data } = await withTimeout(supabase.auth.getSession(), 8000);
        if (!active) return;
        window.sessionStorage.removeItem("mgp-auth-reset");
        if (data.session) {
          await loadProfile();
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
      if (session) {
        await loadProfile();
      } else {
        setProfile(null);
      }
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
        await loadProfile();
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

  return (
    <AuthContext.Provider
      value={{ configured: isSupabaseConfigured, loading, profile, error, signIn, signOut }}
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
      signOut: async () => undefined
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
  supervisor: ["entry", "count-sheets", "production-grid", "dashboard"],
  employee: ["count-sheets"]
};

export const roleLabels: Record<AppRole, string> = {
  admin: "Admin",
  supervisor: "Manager",
  employee: "Counter"
};
