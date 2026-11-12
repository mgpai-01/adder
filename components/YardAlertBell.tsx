"use client";

import { AlertTriangle, Bell, MapPin, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { YardWatch } from "@/lib/yardWatch";

// Header bell (admins / Fleet logins only): watches the production yards —
// Sultana, Merrill, Citrus — and turns red with a count when one has had no
// trailers parked for 30 minutes (lib/yardWatch). Tap for the list; "Show on
// map" opens the Fleet tab zoomed on that yard.

const ALERT_MS = 30 * 60 * 1000;

function sinceText(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hr${minutes % 60 ? ` ${minutes % 60} min` : ""}`;
  return `${Math.floor(hours / 24)} days`;
}

export default function YardAlertBell({
  yards,
  saved = true,
  checkedAt = "",
  darkMode,
  onShowYard
}: {
  yards: YardWatch[] | null;
  // False when the server couldn't keep the timers in the database.
  saved?: boolean;
  // When the server last checked the yards (it checks every minute).
  checkedAt?: string;
  darkMode: boolean;
  onShowYard: (yardId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);
  // Re-render each minute so "empty for N min" (and crossing 30 min) stays current.
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | TouchEvent) => {
      if (box.current && event.target instanceof Node && !box.current.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("touchstart", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const isAlert = (yard: YardWatch) => Boolean(yard.emptySince) && Date.now() - Date.parse(yard.emptySince as string) >= ALERT_MS;
  const alerts = (yards ?? []).filter(isAlert);
  const alarm = alerts.length > 0;
  const muted = darkMode ? "text-steel-100" : "text-steel-500";

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={alarm ? `Yard alert: ${alerts.length} yard${alerts.length === 1 ? "" : "s"} with no trailers` : "Yard alerts"}
        aria-expanded={open}
        title={alarm ? `${alerts.map((yard) => yard.name).join(", ")}: no trailers for 30+ min` : "Yard alerts — production yards"}
        className={`touch-target relative flex w-12 items-center justify-center rounded border ${
          alarm
            ? "border-red-600 bg-red-50 text-red-600"
            : darkMode
              ? "border-white/20 bg-white/10"
              : "border-steel-100 bg-white"
        }`}
      >
        <Bell size={20} className={alarm ? "animate-pulse" : ""} />
        {alarm && (
          <span className="absolute -right-1.5 -top-1.5 min-w-[20px] rounded-full border-2 border-white bg-red-600 px-1 text-center text-[11px] font-black leading-4 text-white">
            {alerts.length}
          </span>
        )}
      </button>

      {open && (
        <div
          className={`absolute right-0 top-full z-50 mt-2 w-[min(400px,calc(100vw-1.5rem))] rounded-lg border p-3 shadow-2xl ${
            darkMode ? "border-white/15 bg-steel-900 text-white" : "border-steel-100 bg-white text-steel-900"
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-base font-black">Yard alerts</p>
              <p className={`text-xs font-bold ${muted}`}>Production yards · alerts after 30 min with no trailers</p>
            </div>
            <button type="button" aria-label="Close" onClick={() => setOpen(false)} className={`min-h-0 rounded p-1 ${darkMode ? "hover:bg-white/10" : "hover:bg-steel-100"}`}>
              <X size={16} />
            </button>
          </div>

          {!saved && (
            <p className="mt-2 rounded bg-amber-50 px-2 py-1.5 text-xs font-bold text-amber-800">
              Timers aren&apos;t being saved to the database right now, so they can restart. Check the fleet_yard_watch table in Supabase.
            </p>
          )}
          {!yards ? (
            <p className={`mt-3 text-sm font-bold ${muted}`}>Checking the yards…</p>
          ) : (
            <ul className="mt-2 grid gap-1.5">
              {yards.map((yard) => {
                const alert = isAlert(yard);
                const waiting = Boolean(yard.emptySince) && !alert;
                return (
                  <li
                    key={yard.yardId}
                    className={`flex items-center justify-between gap-2 rounded border px-3 py-2.5 ${
                      alert
                        ? darkMode
                          ? "border-red-500/50 bg-red-500/15"
                          : "border-red-200 bg-red-50 text-red-900"
                        : waiting
                          ? darkMode
                            ? "border-amber-400/40 bg-amber-400/10"
                            : "border-amber-200 bg-amber-50"
                          : darkMode
                            ? "border-transparent bg-white/[0.06]"
                            : "border-transparent bg-steel-50"
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 truncate text-sm font-black">
                        {alert && <AlertTriangle size={14} className="shrink-0 text-red-600" />}
                        {yard.name}
                      </p>
                      <p className={`text-xs font-bold ${alert ? "text-red-700" : waiting ? "text-amber-700" : muted}`}>
                        {yard.emptySince
                          ? `No trailers for ${sinceText(yard.emptySince)}${alert ? "" : " — alerts at 30 min"} (since ${new Date(yard.emptySince).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })})`
                          : `${yard.trailers} trailer${yard.trailers === 1 ? "" : "s"} · ${yard.trucks} truck${yard.trucks === 1 ? "" : "s"}`}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        onShowYard(yard.yardId);
                      }}
                      className={`flex min-h-0 shrink-0 items-center gap-1 rounded border px-2.5 py-1.5 text-xs font-black ${
                        darkMode ? "border-white/20 hover:bg-white/10" : "border-steel-100 bg-white hover:bg-steel-50"
                      }`}
                    >
                      <MapPin size={12} /> Show on map
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {checkedAt && (
            <p className={`mt-2 text-right text-[11px] font-bold ${muted}`}>
              Last checked {new Date(checkedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · checks every minute
            </p>
          )}
        </div>
      )}
    </div>
  );
}
