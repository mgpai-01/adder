"use client";

import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { clearStoredSession, useAuth } from "@/lib/auth";
import { warmupSupabase } from "@/lib/supabaseBrowser";

export default function LoginScreen() {
  const { signIn, error, requestPasswordReset } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  // Forgot-password panel state.
  const [resetOpen, setResetOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [resetMessage, setResetMessage] = useState("");
  const [resetError, setResetError] = useState("");

  // Warm the Supabase connection as soon as the login screen appears so the
  // first sign-in request does not pay for DNS/TLS/cold-start.
  useEffect(() => {
    warmupSupabase();
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await signIn(identifier, password);
    } catch {
      // error message is surfaced through the auth context
    } finally {
      setBusy(false);
    }
  }

  async function handleReset(event: React.FormEvent) {
    event.preventDefault();
    setResetBusy(true);
    setResetMessage("");
    setResetError("");
    const problem = await requestPasswordReset(resetEmail);
    if (problem) {
      setResetError(problem);
    } else {
      setResetMessage("If that email is on file, a reset link is on its way. Check your inbox.");
    }
    setResetBusy(false);
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl border border-steel-100 bg-white p-7 text-steel-900 shadow-panel">
        <div className="mb-6 flex flex-col items-center text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="Manufacturing Green Products" className="h-16 w-16 rounded-full" />
          <p className="mt-3 text-xs font-bold uppercase tracking-wide text-workshop-700">MGP</p>
          <h1 className="text-2xl font-black">Pallet Repair Tracking</h1>
          <p className="mt-1 text-sm text-steel-500">Sign in to continue</p>
        </div>

        <form onSubmit={handleSubmit} className="grid gap-3">
          <label className="grid gap-1 text-sm font-black">
            Username or email
            <input
              className="field"
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="username"
              placeholder="username"
              required
            />
          </label>
          <label className="grid gap-1 text-sm font-black">
            Password
            <div className="relative">
              <input
                className="field pr-12"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                placeholder="••••••••"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute right-1 top-1/2 flex w-10 -translate-y-1/2 items-center justify-center rounded text-steel-500 hover:text-steel-900"
              >
                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
          </label>

          {error && (
            <div className="rounded bg-red-50 px-3 py-2 text-sm font-bold text-red-700">
              <p>{error}</p>
              <button
                type="button"
                onClick={() => {
                  clearStoredSession();
                  window.location.reload();
                }}
                className="mt-1 underline"
              >
                Stuck? Tap to reset and reload
              </button>
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="touch-target mt-1 flex items-center justify-center rounded bg-workshop-500 px-4 py-3 text-lg font-black text-white disabled:bg-steel-300"
          >
            {busy ? "Signing in…" : "Sign In"}
          </button>

          <button
            type="button"
            onClick={() => {
              setResetOpen((open) => !open);
              setResetEmail(identifier.includes("@") ? identifier : "");
              setResetMessage("");
              setResetError("");
            }}
            className="mt-1 text-sm font-bold text-workshop-700 underline"
          >
            Forgot password?
          </button>
        </form>

        {resetOpen && (
          <form onSubmit={handleReset} className="mt-3 grid gap-2 rounded border border-steel-100 bg-steel-50 p-3">
            <p className="text-sm font-bold text-steel-700">
              Enter the email on your account and we&apos;ll send a reset link.
            </p>
            <input
              className="field"
              type="email"
              value={resetEmail}
              onChange={(event) => setResetEmail(event.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="email"
              placeholder="you@email.com"
              required
            />
            {resetError && <p className="text-sm font-bold text-red-700">{resetError}</p>}
            {resetMessage && <p className="text-sm font-bold text-workshop-700">{resetMessage}</p>}
            <button
              type="submit"
              disabled={resetBusy}
              className="touch-target flex items-center justify-center rounded bg-steel-900 px-4 py-2.5 font-black text-white disabled:bg-steel-300"
            >
              {resetBusy ? "Sending…" : "Send reset link"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
