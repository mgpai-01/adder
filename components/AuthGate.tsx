"use client";

import { useAuth, type AppRole } from "@/lib/auth";
import LoginScreen from "./LoginScreen";
import LoadingLogo from "./LoadingLogo";

// Wraps a page so it requires a signed-in user once Supabase is configured.
// Before Supabase is set up it stays fully open (no behaviour change).
export default function AuthGate({ children, allow }: { children: React.ReactNode; allow?: AppRole[] }) {
  const { configured, loading, profile } = useAuth();

  if (!configured) return <>{children}</>;

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <LoadingLogo />
      </main>
    );
  }

  if (!profile) return <LoginScreen />;

  if (allow && !allow.includes(profile.role)) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4 text-center">
        <div className="max-w-sm rounded-2xl border border-steel-100 bg-white p-7 text-steel-900 shadow-panel">
          <h1 className="text-xl font-black">No access</h1>
          <p className="mt-2 text-sm text-steel-500">
            Your account doesn’t have permission for this screen. Ask an admin if you think this is a mistake.
          </p>
        </div>
      </main>
    );
  }

  return <>{children}</>;
}
