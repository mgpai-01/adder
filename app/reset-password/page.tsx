"use client";

import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { getResetSupabase } from "@/lib/supabaseBrowser";

type Status = "checking" | "ready" | "error" | "done";

export default function ResetPasswordPage() {
  const [status, setStatus] = useState<Status>("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // When the user arrives from the email link, Supabase puts a recovery token
  // in the URL. The reset client (detectSessionInUrl) turns it into a session.
  useEffect(() => {
    const supabase = getResetSupabase();
    if (!supabase) {
      setStatus("error");
      return;
    }
    let settled = false;
    const markReady = () => {
      settled = true;
      setStatus("ready");
    };

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) markReady();
    });

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) markReady();
    });

    // Give the link a moment to be processed before declaring it invalid.
    const timer = setTimeout(() => {
      if (!settled) setStatus("error");
    }, 4000);

    return () => {
      clearTimeout(timer);
      subscription.subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (password.length < 6) {
      setError("Use at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    const supabase = getResetSupabase();
    if (!supabase) return;
    setBusy(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    await supabase.auth.signOut();
    setStatus("done");
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl border border-steel-100 bg-white p-7 text-steel-900 shadow-panel">
        <div className="mb-6 flex flex-col items-center text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="Manufacturing Green Products" className="h-16 w-16 rounded-full" />
          <p className="mt-3 text-xs font-bold uppercase tracking-wide text-workshop-700">MGP</p>
          <h1 className="text-2xl font-black">Reset password</h1>
        </div>

        {status === "checking" && (
          <p className="text-center text-sm font-bold text-steel-500">Checking your reset link…</p>
        )}

        {status === "error" && (
          <div className="grid gap-3 text-center">
            <p className="rounded bg-red-50 px-3 py-2 text-sm font-bold text-red-700">
              This reset link is invalid or has expired. Request a new one from the login screen.
            </p>
            <a href="/" className="text-sm font-bold text-workshop-700 underline">
              Back to sign in
            </a>
          </div>
        )}

        {status === "done" && (
          <div className="grid gap-3 text-center">
            <p className="rounded bg-workshop-100 px-3 py-2 text-sm font-bold text-workshop-700">
              Your password has been updated. You can sign in now.
            </p>
            <a
              href="/"
              className="touch-target flex items-center justify-center rounded bg-workshop-500 px-4 py-3 text-lg font-black text-white"
            >
              Go to sign in
            </a>
          </div>
        )}

        {status === "ready" && (
          <form onSubmit={handleSubmit} className="grid gap-3">
            <label className="grid gap-1 text-sm font-black">
              New password
              <div className="relative">
                <input
                  className="field pr-12"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="new-password"
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
            <label className="grid gap-1 text-sm font-black">
              Confirm password
              <input
                className="field"
                type={showPassword ? "text" : "password"}
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                autoComplete="new-password"
                placeholder="••••••••"
                required
              />
            </label>
            {error && <p className="rounded bg-red-50 px-3 py-2 text-sm font-bold text-red-700">{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="touch-target mt-1 flex items-center justify-center rounded bg-workshop-500 px-4 py-3 text-lg font-black text-white disabled:bg-steel-300"
            >
              {busy ? "Saving…" : "Update password"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
