"use client";

import { Expand, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { employees, locations, payrollSettings, shifts } from "@/lib/data";
import { getWeekKey, wholeNumber } from "@/lib/payroll";
import type { DailyEntry, PayrollSettings, Shift } from "@/lib/types";

type PeriodMode = "today" | "date" | "current-week" | "previous-week" | "custom-week";
type RotationScreen = 0 | 1 | 2;

const refreshInterval = 15_000;
const rotationInterval = 20_000;

function addDays(dateValue: string, days: number) {
  const date = new Date(`${dateValue}T12:00:00`);
  date.setDate(date.getDate() + days);
  return formatLocalDate(date);
}

function getToday() {
  return formatLocalDate(new Date());
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getEmployeeName(employeeId: string) {
  return employees.find((employee) => employee.id === employeeId)?.name ?? employeeId.replaceAll("-", " ");
}

function getLocationName(locationId: string) {
  return locations.find((location) => location.id === locationId)?.name ?? locationId;
}

function quantityForEntry(entry: DailyEntry) {
  return (entry.lines ?? []).reduce((total, line) => total + Number(line.quantity || 0), 0);
}

function readUrlFilters() {
  if (typeof window === "undefined") {
    return {
      location: "all",
      shift: "all",
      period: "today" as PeriodMode,
      date: getToday(),
      week: getWeekKey(getToday())
    };
  }

  const params = new URLSearchParams(window.location.search);
  const locationParam = params.get("location") ?? "all";
  const matchedLocation = locations.find((location) => location.name.toLowerCase() === locationParam.toLowerCase() || location.id === locationParam);
  const shiftParam = params.get("shift") ?? "all";
  const periodParam = params.get("period") as PeriodMode | null;
  const dateParam = params.get("date") ?? getToday();
  const weekParam = params.get("week") ?? getWeekKey(getToday());

  return {
    location: matchedLocation?.id ?? "all",
    shift: shifts.includes(shiftParam as Shift) ? shiftParam : "all",
    period: periodParam ?? (params.has("date") ? "date" : params.has("week") ? "custom-week" : "today"),
    date: dateParam,
    week: getWeekKey(weekParam)
  };
}

export default function LiveBoardPage() {
  const initialFilters = useMemo(readUrlFilters, []);
  const [entries, setEntries] = useState<DailyEntry[]>([]);
  const [settings, setSettings] = useState<PayrollSettings>(payrollSettings);
  const [locationFilter, setLocationFilter] = useState(initialFilters.location);
  const [shiftFilter, setShiftFilter] = useState(initialFilters.shift);
  const [periodMode, setPeriodMode] = useState<PeriodMode>(initialFilters.period);
  const [selectedDate, setSelectedDate] = useState(initialFilters.date);
  const [selectedWeek, setSelectedWeek] = useState(initialFilters.week);
  const [now, setNow] = useState(new Date());
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [rotationScreen, setRotationScreen] = useState<RotationScreen>(0);
  const [rotationEnabled, setRotationEnabled] = useState(true);
  const [cursorHidden, setCursorHidden] = useState(false);

  async function loadData() {
    const [entryResponse, settingsResponse] = await Promise.all([fetch("/api/entries", { cache: "no-store" }), fetch("/api/settings", { cache: "no-store" })]);
    const entryResult = (await entryResponse.json()) as { entries: DailyEntry[] };
    const settingsResult = (await settingsResponse.json()) as { settings: PayrollSettings };
    setEntries(entryResult.entries ?? []);
    setSettings({ ...payrollSettings, ...settingsResult.settings });
    setLastUpdated(new Date());
  }

  useEffect(() => {
    loadData().catch(() => undefined);
    const refreshTimer = window.setInterval(() => loadData().catch(() => undefined), refreshInterval);
    const clockTimer = window.setInterval(() => setNow(new Date()), 1_000);
    return () => {
      window.clearInterval(refreshTimer);
      window.clearInterval(clockTimer);
    };
  }, []);

  useEffect(() => {
    if (!rotationEnabled) return;
    const timer = window.setInterval(() => setRotationScreen((screen) => ((screen + 1) % 3) as RotationScreen), rotationInterval);
    return () => window.clearInterval(timer);
  }, [rotationEnabled]);

  useEffect(() => {
    let cursorTimer = window.setTimeout(() => setCursorHidden(true), 5_000);
    const showCursor = () => {
      setCursorHidden(false);
      window.clearTimeout(cursorTimer);
      cursorTimer = window.setTimeout(() => setCursorHidden(true), 5_000);
    };
    window.addEventListener("mousemove", showCursor);
    return () => {
      window.clearTimeout(cursorTimer);
      window.removeEventListener("mousemove", showCursor);
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (locationFilter !== "all") params.set("location", getLocationName(locationFilter));
    if (shiftFilter !== "all") params.set("shift", shiftFilter);
    if (periodMode !== "today") params.set("period", periodMode);
    if (periodMode === "date") params.set("date", selectedDate);
    if (periodMode === "custom-week") params.set("week", selectedWeek);
    const query = params.toString();
    window.history.replaceState(null, "", query ? `/live-board?${query}` : "/live-board");
  }, [locationFilter, periodMode, selectedDate, selectedWeek, shiftFilter]);

  const filteredEntries = useMemo(() => {
    const today = getToday();
    const currentWeek = getWeekKey(today);
    const previousWeek = addDays(currentWeek, -7);
    const weekStart = periodMode === "previous-week" ? previousWeek : periodMode === "custom-week" ? selectedWeek : currentWeek;
    const weekEnd = addDays(weekStart, 6);

    return entries.filter((entry) => {
      if (locationFilter !== "all" && entry.locationId !== locationFilter) return false;
      if (shiftFilter !== "all" && entry.shift !== shiftFilter) return false;
      if (periodMode === "today" && entry.date !== today) return false;
      if (periodMode === "date" && entry.date !== selectedDate) return false;
      if ((periodMode === "current-week" || periodMode === "previous-week" || periodMode === "custom-week") && (entry.date < weekStart || entry.date > weekEnd)) return false;
      return true;
    });
  }, [entries, locationFilter, periodMode, selectedDate, selectedWeek, shiftFilter]);

  const repairerRows = useMemo(() => {
    const totals = new Map<string, { employeeId: string; name: string; locationId: string; shift: Shift; quantity: number }>();
    for (const entry of filteredEntries) {
      const row = totals.get(entry.employeeId) ?? {
        employeeId: entry.employeeId,
        name: getEmployeeName(entry.employeeId),
        locationId: entry.locationId,
        shift: entry.shift,
        quantity: 0
      };
      row.quantity += quantityForEntry(entry);
      totals.set(entry.employeeId, row);
    }
    return Array.from(totals.values()).sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name));
  }, [filteredEntries]);

  const locationRows = useMemo(() => {
    const totals = new Map<string, number>();
    for (const entry of filteredEntries) {
      totals.set(entry.locationId, (totals.get(entry.locationId) ?? 0) + quantityForEntry(entry));
    }
    return locations
      .filter((location) => locationFilter === "all" || location.id === locationFilter)
      .map((location) => ({ id: location.id, name: location.name, quantity: totals.get(location.id) ?? 0 }))
      .sort((a, b) => b.quantity - a.quantity);
  }, [filteredEntries, locationFilter]);

  const companyTotal = repairerRows.reduce((total, row) => total + row.quantity, 0);
  const goal = Math.max(0, settings.dailyProductionGoal || 4500);
  const goalPercent = goal > 0 ? Math.min(100, Math.round((companyTotal / goal) * 100)) : 0;
  const selectedLocationLabel = locationFilter === "all" ? "All Locations" : getLocationName(locationFilter);
  const selectedShiftLabel = shiftFilter === "all" ? "All Shifts" : `${shiftFilter} Shift`;
  const periodLabel =
    periodMode === "today"
      ? new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(now)
      : periodMode === "date"
        ? new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date(`${selectedDate}T12:00:00`))
        : `${periodMode === "previous-week" ? "Previous Week" : "Week"} of ${new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(new Date(`${periodMode === "custom-week" ? selectedWeek : getWeekKey(getToday())}T12:00:00`))}`;

  async function enterFullscreen() {
    await document.documentElement.requestFullscreen?.();
  }

  const maxQuantity = repairerRows[0]?.quantity || 1;
  const clockLabel = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const controlClass = "h-11 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-base font-semibold text-white/90 outline-none";

  return (
    <main className={`min-h-screen bg-[#0b0f0e] text-white ${cursorHidden ? "cursor-none" : ""}`}>
      <header className="flex flex-wrap items-center justify-between gap-6 px-10 pt-8">
        <div className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="Manufacturing Green Products" className="h-14 w-14 shrink-0 rounded-full bg-white" />
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight">Live Pallet Tracker</h1>
              <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.2em] text-[#92d6a1]">
                <span className="h-2 w-2 rounded-full bg-[#92d6a1] [animation:board-pulse-dot_1.8s_ease-in-out_infinite]" />
                Live
              </span>
            </div>
            <p className="mt-1 text-base font-medium text-white/45">
              {periodLabel} · {clockLabel} · {selectedLocationLabel} · {selectedShiftLabel}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" aria-label="Refresh" className="flex h-11 w-11 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-white/70 transition-colors hover:text-white" onClick={() => loadData().catch(() => undefined)}>
            <RefreshCw size={20} />
          </button>
          <button type="button" aria-label="Fullscreen" className="flex h-11 w-11 items-center justify-center rounded-lg border border-[#92d6a1]/40 bg-[#92d6a1]/10 text-[#aef2bc] transition-colors hover:bg-[#92d6a1]/20" onClick={enterFullscreen}>
            <Expand size={20} />
          </button>
        </div>
      </header>

      <div className="flex flex-wrap gap-2 px-10 pt-5">
        <select className={controlClass} value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)}>
          <option className="text-steel-900" value="all">All Locations</option>
          {locations.map((location) => <option className="text-steel-900" key={location.id} value={location.id}>{location.name}</option>)}
        </select>
        <select className={controlClass} value={shiftFilter} onChange={(event) => setShiftFilter(event.target.value)}>
          <option className="text-steel-900" value="all">All Shifts</option>
          {shifts.map((shift) => <option className="text-steel-900" key={shift} value={shift}>{shift}</option>)}
        </select>
        <select className={controlClass} value={periodMode} onChange={(event) => setPeriodMode(event.target.value as PeriodMode)}>
          <option className="text-steel-900" value="today">Today</option>
          <option className="text-steel-900" value="date">Specific Date</option>
          <option className="text-steel-900" value="current-week">Current Week</option>
          <option className="text-steel-900" value="previous-week">Previous Week</option>
          <option className="text-steel-900" value="custom-week">Custom Week</option>
        </select>
        <input className={controlClass} type="date" value={periodMode === "custom-week" ? selectedWeek : selectedDate} onChange={(event) => periodMode === "custom-week" ? setSelectedWeek(getWeekKey(event.target.value)) : setSelectedDate(event.target.value)} disabled={periodMode !== "date" && periodMode !== "custom-week"} />
        <button type="button" className={controlClass} onClick={() => setRotationEnabled((value) => !value)}>Rotation: {rotationEnabled ? "On" : "Off"}</button>
      </div>

      <section className="grid gap-10 px-10 py-8 pb-20">
        {rotationScreen === 0 && (
          <div className="grid gap-10 xl:grid-cols-[1.4fr_0.6fr]">
            <div>
              <SectionLabel>Ranking</SectionLabel>
              {repairerRows.length === 0 ? (
                <EmptyBoardMessage />
              ) : (
                <div className="grid gap-6">
                  <Podium rows={repairerRows.slice(0, 3)} />
                  {repairerRows.length > 3 && (
                    <div className="divide-y divide-white/5 overflow-hidden rounded-2xl border border-white/10">
                      {repairerRows.slice(3, 12).map((row, position) => (
                        <div key={row.employeeId} className="flex items-center gap-5 px-6 py-4">
                          <span className="w-8 text-2xl font-bold tabular-nums text-white/30">{position + 4}</span>
                          <BoardAvatar name={row.name} size={48} />
                          <span className="flex-1 truncate text-3xl font-semibold">{row.name}</span>
                          <span className="text-4xl font-bold tabular-nums">{wholeNumber(row.quantity)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="grid content-start gap-6">
              <GrandTotal total={companyTotal} />
              <GoalTracker actual={companyTotal} goal={goal} percent={goalPercent} />
            </div>
          </div>
        )}

        {rotationScreen === 1 && (
          <div className="grid gap-10 xl:grid-cols-2">
            <div>
              <SectionLabel>Location Totals</SectionLabel>
              <div className="divide-y divide-white/5 overflow-hidden rounded-2xl border border-white/10">
                {locationRows.map((location) => (
                  <div key={location.id} className="flex items-center justify-between px-8 py-8">
                    <span className="text-5xl font-semibold">{location.name}</span>
                    <span className="text-6xl font-bold tabular-nums text-[#aef2bc]">{wholeNumber(location.quantity)}</span>
                  </div>
                ))}
                {locationRows.length === 0 && <EmptyBoardMessage />}
              </div>
            </div>
            <div className="grid content-start gap-6">
              <GoalTracker actual={companyTotal} goal={goal} percent={goalPercent} />
              <GrandTotal total={companyTotal} />
            </div>
          </div>
        )}

        {rotationScreen === 2 && (
          <div>
            <SectionLabel>Repairer Detail</SectionLabel>
            <div className="overflow-hidden rounded-2xl border border-white/10">
              <table className="w-full text-left">
                <thead className="text-base font-semibold uppercase tracking-widest text-white/40">
                  <tr className="border-b border-white/10">
                    <th className="px-6 py-4">Rank</th>
                    <th className="px-6 py-4">Repairer</th>
                    <th className="px-6 py-4">Location</th>
                    <th className="px-6 py-4">Shift</th>
                    <th className="px-6 py-4 text-right">Qty</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {repairerRows.map((row, index) => (
                    <tr key={row.employeeId} className="text-3xl font-semibold">
                      <td className="px-6 py-4 tabular-nums text-white/30">{index + 1}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <BoardAvatar name={row.name} size={44} />
                          {row.name}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-white/60">{getLocationName(row.locationId)}</td>
                      <td className="px-6 py-4 text-white/60">{row.shift}</td>
                      <td className="px-6 py-4 text-right tabular-nums text-[#aef2bc]">{wholeNumber(row.quantity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {repairerRows.length === 0 && <EmptyBoardMessage />}
            </div>
          </div>
        )}
      </section>

      <footer className="fixed bottom-0 left-0 right-0 flex items-center justify-between border-t border-white/10 bg-[#0b0f0e]/90 px-10 py-3 text-sm font-medium text-white/40 backdrop-blur">
        <span>Updated live · Screen {rotationScreen + 1} of 3</span>
        <span>{lastUpdated ? `Last updated ${lastUpdated.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })}` : "Loading…"}</span>
      </footer>
    </main>
  );
}

function useCountUp(value: number, duration = 900) {
  const [display, setDisplay] = useState(value);
  const previous = useRef(value);
  useEffect(() => {
    const start = previous.current;
    const end = value;
    if (start === end) return;
    let frame = 0;
    const startTime = performance.now();
    const tick = (time: number) => {
      const progress = Math.min(1, (time - startTime) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(start + (end - start) * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
      else previous.current = end;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);
  return display;
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="mb-5 text-sm font-bold uppercase tracking-[0.25em] text-white/40">{children}</p>;
}

type BoardRow = { employeeId: string; name: string; locationId: string; shift: Shift; quantity: number };

function Podium({ rows }: { rows: BoardRow[] }) {
  const [first, second, third] = rows;
  const order: Array<{ row?: BoardRow; rank: number }> = [
    { row: second, rank: 2 },
    { row: first, rank: 1 },
    { row: third, rank: 3 }
  ];
  return (
    <div className="grid grid-cols-3 gap-5">
      {order.map((slot, index) => (slot.row ? <PodiumCard key={slot.row.employeeId} row={slot.row} rank={slot.rank} /> : <div key={index} />))}
    </div>
  );
}

function PodiumCard({ row, rank }: { row: BoardRow; rank: number }) {
  const isFirst = rank === 1;
  return (
    <div className={`flex flex-col items-center rounded-2xl border px-5 py-7 text-center ${isFirst ? "border-[#92d6a1]/40 bg-[#92d6a1]/[0.06]" : "border-white/10"}`}>
      <span className={`text-sm font-bold uppercase tracking-[0.2em] ${isFirst ? "text-[#aef2bc]" : "text-white/35"}`}>
        {rank === 1 ? "1st" : rank === 2 ? "2nd" : "3rd"}
      </span>
      <div className="mt-4">
        <BoardAvatar name={row.name} size={isFirst ? 104 : 80} />
      </div>
      <span className={`mt-4 w-full truncate font-semibold ${isFirst ? "text-3xl" : "text-2xl"}`}>{row.name}</span>
      <span className={`mt-1 font-bold tabular-nums ${isFirst ? "text-7xl text-[#aef2bc]" : "text-6xl"}`}>{wholeNumber(row.quantity)}</span>
    </div>
  );
}

function GrandTotal({ total }: { total: number }) {
  const shown = useCountUp(total);
  return (
    <div className="rounded-2xl border border-white/10 p-8 text-center">
      <span className="text-sm font-bold uppercase tracking-[0.25em] text-white/40">Company Total</span>
      <p className="mt-3 text-8xl font-bold tabular-nums">{wholeNumber(shown)}</p>
      <span className="mt-1 block text-base font-semibold uppercase tracking-[0.2em] text-[#92d6a1]">Pallets</span>
    </div>
  );
}

function GoalTracker({ actual, goal, percent }: { actual: number; goal: number; percent: number }) {
  const radius = 56;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="rounded-2xl border border-white/10 p-8">
      <span className="text-sm font-bold uppercase tracking-[0.25em] text-white/40">Today&apos;s Goal</span>
      <div className="mt-6 flex items-center justify-center gap-8">
        <div className="relative h-44 w-44">
          <svg viewBox="0 0 130 130" className="h-full w-full -rotate-90">
            <circle cx="65" cy="65" r={radius} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="8" />
            <circle cx="65" cy="65" r={radius} fill="none" stroke="#92d6a1" strokeWidth="8" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - percent / 100)} className="transition-all duration-700" />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-5xl font-bold tabular-nums">{percent}%</span>
          </div>
        </div>
        <div className="text-right">
          <p className="text-4xl font-bold tabular-nums">{wholeNumber(actual)}</p>
          <p className="text-base font-semibold text-white/40">of {wholeNumber(goal)}</p>
        </div>
      </div>
    </div>
  );
}

function BoardAvatar({ name, size = 56 }: { name: string; size?: number }) {
  const initials = name.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div style={{ height: size, width: size, fontSize: size * 0.36 }} className="flex shrink-0 items-center justify-center rounded-full bg-[#1f2a25] font-bold text-[#aef2bc]">
      {initials || "?"}
    </div>
  );
}

function EmptyBoardMessage() {
  return <div className="rounded-2xl border border-white/10 p-10 text-center text-2xl font-semibold text-white/40">No production entries for this selection.</div>;
}
