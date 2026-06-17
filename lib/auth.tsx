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

export function AuthProvider({ children }: { children: ReactNode }) {
  const supabase = getBrowserSupabase();
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState("");

  const loadProfile = useCallback(async () => {
    if (!supabase) return;
    try {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;
      if (!user) {
        setProfile(null);
        return;
      }

      const { data, error: profileError } = await supabase
        .from("profiles")
        .select("id, username, full_name, role, active")
        .eq("id", user.id)
        .maybeSingle();

      if (profileError || !data) {
        setError("This login has no access set up yet. Ask an admin.");
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
    } catch {
      setProfile(null);
    }
  }, [supabase]);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      if (data.session) {
        await loadProfile();
      }
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange(async (_event, session) => {
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
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: toEmail(identifier),
        password
      });
      if (signInError || !data.session) {
        setError("Wrong username/email or password.");
        throw signInError ?? new Error("Sign in failed.");
      }
      await loadProfile();
    },
    [supabase, loadProfile]
  );

  const signOut = useCallback(async () => {
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

// Which app views each role may open. Admin sees everything; Manager runs
// production and reports; Counter only handles count sheets.
export const roleViews: Record<AppRole, string[]> = {
  admin: ["entry", "count-sheets", "production-grid", "dashboard", "payroll", "settings"],
  supervisor: ["entry", "count-sheets", "production-grid", "dashboard"],
  employee: ["count-sheets"]
};

export const roleLabels: Record<AppRole, string> = {
  admin: "Admin",
  supervisor: "Manager",
  employee: "Counter"
};
