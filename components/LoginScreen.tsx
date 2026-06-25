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
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      {/* Brand-tinted scrim over the page's warehouse photo so the card pops */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-steel-900/85 via-workshop-700/70 to-steel-900/90" />

      {/* Soft animated aurora backdrop */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <span className="absolute -left-40 -top-32 h-[42rem] w-[42rem] rounded-full bg-safety-400/40 blur-[120px] [animation:aurora-a_20s_ease-in-out_infinite]" />
        <span className="absolute -bottom-44 -right-40 h-[40rem] w-[40rem] rounded-full bg-workshop-500/45 blur-[120px] [animation:aurora-b_24s_ease-in-out_infinite]" />
        <span className="absolute bottom-0 left-1/3 h-[30rem] w-[30rem] rounded-full bg-safety-500/30 blur-[110px] [animation:aurora-c_28s_ease-in-out_infinite]" />
      </div>

      <div className="relative w-full max-w-sm overflow-hidden rounded-[1.75rem] border border-white/30 bg-white/75 text-steel-900 shadow-[0_24px_70px_-20px_rgba(11,82,42,0.55)] ring-1 ring-white/40 backdrop-blur-2xl [animation:board-rise_0.5s_ease-out]">
        {/* Gradient accent strip along the top edge */}
        <div className="h-1.5 w-full bg-gradient-to-r from-safety-400 via-workshop-500 to-workshop-700" />

        <div className="p-8">
          <div className="mb-7 flex flex-col items-center text-center">
            <div className="relative">
              <span className="absolute -inset-2 -z-10 rounded-full bg-gradient-to-br from-safety-400 to-workshop-700 opacity-70 blur-lg [animation:mgp-pulse-ring_3.5s_ease-out_infinite]" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logo.svg"
                alt="Manufacturing Green Products"
                className="h-[4.5rem] w-[4.5rem] rounded-full ring-2 ring-white shadow-lg"
              />
            </div>
            <p className="mt-4 text-[0.7rem] font-bold uppercase tracking-[0.22em] text-workshop-700">MGP</p>
            <h1 className="mt-1 text-[1.65rem] font-black leading-tight tracking-tight">Pallet Repair Tracking</h1>
            <p className="mt-1.5 text-sm text-steel-500">Sign in to continue</p>
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
            className="touch-target mt-2 flex items-center justify-center rounded-xl bg-gradient-to-r from-workshop-500 to-workshop-700 px-4 py-3 text-lg font-black text-white shadow-md shadow-workshop-700/20 transition-all hover:shadow-lg hover:shadow-workshop-700/30 active:scale-[0.99] disabled:from-steel-300 disabled:to-steel-300 disabled:shadow-none"
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
            className="mt-1 justify-self-center text-sm font-bold text-workshop-700 underline-offset-4 transition-colors hover:text-workshop-500 hover:underline"
          >
            Forgot password?
          </button>
        </form>

        {resetOpen && (
          <form onSubmit={handleReset} className="mt-4 grid gap-2 rounded-2xl border border-steel-100 bg-steel-50/80 p-4 [animation:board-rise_0.3s_ease-out]">
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
              className="touch-target flex items-center justify-center rounded-xl bg-steel-900 px-4 py-2.5 font-black text-white shadow-sm transition-all hover:bg-steel-800 active:scale-[0.99] disabled:bg-steel-300 disabled:shadow-none"
            >
              {resetBusy ? "Sending…" : "Send reset link"}
            </button>
          </form>
        )}
        </div>
      </div>
    </main>
  );
}
