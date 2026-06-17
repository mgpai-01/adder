"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth";

export default function LoginScreen() {
  const { signIn, error } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

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
            <input
              className="field"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              placeholder="••••••••"
              required
            />
          </label>

          {error && (
            <p className="rounded bg-red-50 px-3 py-2 text-sm font-bold text-red-700">{error}</p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="touch-target mt-1 flex items-center justify-center rounded bg-workshop-500 px-4 py-3 text-lg font-black text-white disabled:bg-steel-300"
          >
            {busy ? "Signing in…" : "Sign In"}
          </button>
        </form>
      </div>
    </main>
  );
}
