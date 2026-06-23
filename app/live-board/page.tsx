"use client";

import { Crown, Expand, MapPin, RefreshCw, Target, Trophy } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { employees, locations, payrollSettings, shifts } from "@/lib/data";
import { getWeekKey, wholeNumber } from "@/lib/payroll";
import type { DailyEntry, PayrollSettings, Shift } from "@/lib/types";

type PeriodMode = "today" | "date" | "current-week" | "previous-week" | "custom-week";

const refreshInterval = 15_000;

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
  const [cursorHidden, setCursorHidden] = useState(false);
  const [roster, setRoster] = useState<Record<string, { name: string; photo?: string }>>({});
  const [isFullscreen, setIsFullscreen] = useState(false);

  async function loadData() {
    const [entryResponse, settingsResponse, employeesResponse] = await Promise.all([
      fetch("/api/entries", { cache: "no-store" }),
      fetch("/api/settings", { cache: "no-store" }),
      fetch("/api/employees", { cache: "no-store" })
    ]);
    const entryResult = (await entryResponse.json()) as { entries: DailyEntry[] };
    const settingsResult = (await settingsResponse.json()) as { settings: PayrollSettings };
    const employeesResult = (await employeesResponse.json()) as { employees?: Array<{ id: string; name: string; photoDataUrl?: string }> };
    const rosterMap: Record<string, { name: string; photo?: string }> = {};
    for (const employee of employeesResult.employees ?? []) {
      rosterMap[employee.id] = { name: employee.name, photo: employee.photoDataUrl || undefined };
    }
    setRoster(rosterMap);
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
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

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
    const totals = new Map<string, { employeeId: string; name: string; photo?: string; locationId: string; shift: Shift; quantity: number }>();
    for (const entry of filteredEntries) {
      const row = totals.get(entry.employeeId) ?? {
        employeeId: entry.employeeId,
        name: roster[entry.employeeId]?.name ?? getEmployeeName(entry.employeeId),
        photo: roster[entry.employeeId]?.photo,
        locationId: entry.locationId,
        shift: entry.shift,
        quantity: 0
      };
      row.quantity += quantityForEntry(entry);
      totals.set(entry.employeeId, row);
    }
    return Array.from(totals.values()).sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name));
  }, [filteredEntries, roster]);

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
  const control = "h-11 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-base font-semibold text-white/90 outline-none backdrop-blur";

  return (
    <main
      className={`flex h-screen flex-col overflow-hidden text-white ${cursorHidden ? "cursor-none" : ""}`}
      style={{
        background:
          "radial-gradient(1000px 600px at 85% -15%, rgba(146,214,161,0.12), transparent 60%), radial-gradient(800px 600px at -10% 110%, rgba(42,107,64,0.16), transparent 60%), linear-gradient(180deg, #0b1410 0%, #070d0a 100%)"
      }}
    >
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-6 px-10 pt-6">
        <div className="flex items-center gap-4">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-1.5 shadow-lg backdrop-blur">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="Manufacturing Green Products" className="h-16 w-16 rounded-full bg-white" />
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-4xl font-black tracking-tight 2xl:text-5xl">
                Live <span className="bg-gradient-to-r from-[#92d6a1] to-[#aef2bc] bg-clip-text text-transparent">Pallet Tracker</span>
              </h1>
              <span className="flex items-center gap-1.5 rounded-full border border-[#92d6a1]/40 bg-[#92d6a1]/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.2em] text-[#aef2bc]">
                <span className="h-2 w-2 rounded-full bg-[#92d6a1] [animation:board-pulse-dot_1.6s_ease-in-out_infinite]" />
                Live
              </span>
            </div>
            <p className="mt-1.5 text-lg font-medium text-white/50 2xl:text-xl">{periodLabel} · {clockLabel} · {selectedLocationLabel} · {selectedShiftLabel}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" aria-label="Refresh" className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05] text-white/70 backdrop-blur transition-colors hover:text-white" onClick={() => loadData().catch(() => undefined)}>
            <RefreshCw size={20} />
          </button>
          <button type="button" className="flex h-12 items-center gap-2 rounded-xl bg-gradient-to-r from-[#2a6b40] to-[#3f8a55] px-5 font-bold text-white shadow-lg shadow-[#2a6b40]/25 transition-transform hover:scale-[1.03]" onClick={enterFullscreen}>
            <Expand size={20} />
            Fullscreen
          </button>
        </div>
      </header>

      <div className="flex shrink-0 px-10 pt-4">
        <div className="flex flex-wrap gap-1 rounded-2xl border border-white/10 bg-white/[0.04] p-1.5 backdrop-blur">
          <YardTab active={locationFilter === "all"} onClick={() => setLocationFilter("all")}>All Yards</YardTab>
          {locations.map((location) => (
            <YardTab key={location.id} active={locationFilter === location.id} onClick={() => setLocationFilter(location.id)}>
              {location.name}
            </YardTab>
          ))}
        </div>
      </div>

      {!isFullscreen && (
        <div className="flex shrink-0 flex-wrap gap-2 px-10 pt-4">
          <select className={control} value={shiftFilter} onChange={(event) => setShiftFilter(event.target.value)}>
            <option className="text-steel-900" value="all">All Shifts</option>
            {shifts.map((shift) => <option className="text-steel-900" key={shift} value={shift}>{shift}</option>)}
          </select>
          <select className={control} value={periodMode} onChange={(event) => setPeriodMode(event.target.value as PeriodMode)}>
            <option className="text-steel-900" value="today">Today</option>
            <option className="text-steel-900" value="date">Specific Date</option>
            <option className="text-steel-900" value="current-week">Current Week</option>
            <option className="text-steel-900" value="previous-week">Previous Week</option>
            <option className="text-steel-900" value="custom-week">Custom Week</option>
          </select>
          <input className={control} type="date" value={periodMode === "custom-week" ? selectedWeek : selectedDate} onChange={(event) => periodMode === "custom-week" ? setSelectedWeek(getWeekKey(event.target.value)) : setSelectedDate(event.target.value)} disabled={periodMode !== "date" && periodMode !== "custom-week"} />
        </div>
      )}

      <section className="min-h-0 flex-1 overflow-hidden px-10 pb-3 pt-4">
        <div className="grid h-full gap-8 xl:grid-cols-[1.5fr_0.9fr]">
          <GlassCard className="flex min-h-0 flex-col">
            <SectionLabel icon={<Trophy size={22} />}>Ranking</SectionLabel>
            {repairerRows.length === 0 ? (
              <EmptyBoardMessage />
            ) : (
              <div className="flex min-h-0 flex-1 flex-col gap-6">
                <Podium rows={repairerRows.slice(0, 3)} />
                {repairerRows.length > 3 && (
                  <div className="min-h-0 flex-1 divide-y divide-white/5 overflow-hidden">
                    {repairerRows.slice(3).map((row, position) => {
                      const pct = Math.round((row.quantity / maxQuantity) * 100);
                      return (
                        <div key={row.employeeId} className="flex items-center gap-5 py-3">
                          <span className="w-8 text-2xl font-bold tabular-nums text-white/30">{position + 4}</span>
                          <BoardAvatar name={row.name} photo={row.photo} size={44} />
                          <div className="min-w-0 flex-1">
                            <span className="block truncate text-2xl font-bold">{row.name}</span>
                            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/5">
                              <div className="h-full rounded-full bg-gradient-to-r from-[#2a6b40] to-[#92d6a1] transition-all duration-700" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                          <span className="text-3xl font-black tabular-nums">{wholeNumber(row.quantity)}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </GlassCard>

          <div className="grid min-h-0 grid-rows-[auto_auto_1fr] gap-6">
            <GrandTotal total={companyTotal} />
            <GoalTracker actual={companyTotal} goal={goal} percent={goalPercent} />
            <GlassCard className="flex min-h-0 flex-col">
              <SectionLabel icon={<MapPin size={22} />}>Location Totals</SectionLabel>
              <div className="grid min-h-0 flex-1 content-start gap-3 overflow-hidden">
                {locationRows.map((location) => {
                  const pct = Math.round((location.quantity / (locationRows[0]?.quantity || 1)) * 100);
                  return (
                    <div key={location.id} className="rounded-2xl border border-white/10 bg-white/[0.03] px-6 py-4">
                      <div className="flex items-center justify-between">
                        <span className="text-3xl font-bold">{location.name}</span>
                        <span className="text-4xl font-black tabular-nums text-[#aef2bc]">{wholeNumber(location.quantity)}</span>
                      </div>
                      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/5">
                        <div className="h-full rounded-full bg-gradient-to-r from-[#2a6b40] to-[#92d6a1] transition-all duration-700" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
                {locationRows.length === 0 && <EmptyBoardMessage />}
              </div>
            </GlassCard>
          </div>
        </div>
      </section>

      <footer className="flex shrink-0 items-center justify-between border-t border-white/10 bg-black/30 px-10 py-2.5 text-sm font-medium text-white/40 backdrop-blur-xl">
        <span>Live · auto-refresh every 15s</span>
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

function GlassCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-3xl border border-white/10 bg-white/[0.045] p-7 shadow-[0_10px_40px_rgba(0,0,0,0.45)] backdrop-blur-xl ${className}`}>{children}</div>;
}

function SectionLabel({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="mb-6 flex items-center gap-2.5">
      <span className="text-[#92d6a1]">{icon}</span>
      <h2 className="text-xl font-black uppercase tracking-[0.2em] text-white/80">{children}</h2>
    </div>
  );
}

function YardTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl px-5 py-2.5 text-lg font-bold transition-colors ${
        active ? "bg-gradient-to-r from-[#2a6b40] to-[#3f8a55] text-white shadow" : "text-white/55 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

type BoardRow = { employeeId: string; name: string; photo?: string; locationId: string; shift: Shift; quantity: number };

function Podium({ rows }: { rows: BoardRow[] }) {
  const [first, second, third] = rows;
  const order: Array<{ row?: BoardRow; rank: number }> = [
    { row: second, rank: 2 },
    { row: first, rank: 1 },
    { row: third, rank: 3 }
  ];
  return (
    <div className="grid grid-cols-3 items-end gap-5">
      {order.map((slot, index) => (slot.row ? <PodiumCard key={slot.row.employeeId} row={slot.row} rank={slot.rank} /> : <div key={index} />))}
    </div>
  );
}

function PodiumCard({ row, rank }: { row: BoardRow; rank: number }) {
  const isFirst = rank === 1;
  return (
    <div
      style={isFirst ? { animation: "board-glow 3.4s ease-in-out infinite" } : undefined}
      className={`relative flex flex-col items-center rounded-3xl border text-center backdrop-blur-xl ${
        isFirst
          ? "border-[#92d6a1]/50 bg-gradient-to-b from-[#92d6a1]/[0.16] to-white/[0.02] px-6 pb-8 pt-9"
          : "border-white/10 bg-white/[0.05] px-5 pb-6 pt-8"
      }`}
    >
      <span className={`absolute -top-3.5 rounded-full border px-3 py-1 text-xs font-black uppercase tracking-[0.2em] ${isFirst ? "border-[#92d6a1]/50 bg-[#0c1512] text-[#aef2bc]" : "border-white/15 bg-[#0c1512] text-white/50"}`}>
        {rank === 1 ? "Leader" : rank === 2 ? "2nd" : "3rd"}
      </span>
      {isFirst && <Crown size={30} className="mb-1 text-[#aef2bc]" />}
      <BoardAvatar name={row.name} photo={row.photo} size={isFirst ? 104 : 80} ring />
      <span className={`mt-4 w-full truncate font-bold ${isFirst ? "text-3xl" : "text-2xl"}`}>{row.name}</span>
      <span className={`mt-1 font-black tabular-nums ${isFirst ? "bg-gradient-to-b from-white to-[#aef2bc] bg-clip-text text-7xl text-transparent" : "text-6xl text-[#aef2bc]"}`}>{wholeNumber(row.quantity)}</span>
      <span className="text-sm font-bold uppercase tracking-[0.2em] text-white/35">pallets</span>
    </div>
  );
}

function GrandTotal({ total }: { total: number }) {
  const shown = useCountUp(total);
  return (
    <div className="relative overflow-hidden rounded-3xl border border-[#92d6a1]/25 bg-gradient-to-b from-[#92d6a1]/[0.12] to-white/[0.02] p-8 text-center shadow-[0_10px_40px_rgba(0,0,0,0.4)] backdrop-blur-xl">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.svg" alt="" className="pointer-events-none absolute -right-10 -top-10 h-44 w-44 opacity-[0.05]" />
      <span className="relative text-sm font-black uppercase tracking-[0.25em] text-[#aef2bc]">Company Total</span>
      <p className="relative mt-3 bg-gradient-to-b from-white to-[#cfeed8] bg-clip-text text-8xl font-black tabular-nums text-transparent">{wholeNumber(shown)}</p>
      <span className="relative mt-1 block text-base font-bold uppercase tracking-[0.2em] text-white/45">Pallets</span>
    </div>
  );
}

function GoalTracker({ actual, goal, percent }: { actual: number; goal: number; percent: number }) {
  const radius = 56;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.045] p-8 shadow-[0_10px_40px_rgba(0,0,0,0.4)] backdrop-blur-xl">
      <div className="flex items-center gap-2.5">
        <Target size={22} className="text-[#92d6a1]" />
        <h2 className="text-xl font-black uppercase tracking-[0.2em] text-white/80">Today&apos;s Goal</h2>
      </div>
      <div className="mt-6 flex items-center justify-center gap-8">
        <div className="relative h-44 w-44">
          <svg viewBox="0 0 130 130" className="h-full w-full -rotate-90">
            <defs>
              <linearGradient id="goalGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#2a6b40" />
                <stop offset="1" stopColor="#aef2bc" />
              </linearGradient>
            </defs>
            <circle cx="65" cy="65" r={radius} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="9" />
            <circle cx="65" cy="65" r={radius} fill="none" stroke="url(#goalGrad)" strokeWidth="9" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - percent / 100)} className="transition-all duration-700" />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-5xl font-black tabular-nums">{percent}%</span>
          </div>
        </div>
        <div className="text-right">
          <p className="text-4xl font-black tabular-nums">{wholeNumber(actual)}</p>
          <p className="text-base font-semibold text-white/40">of {wholeNumber(goal)}</p>
        </div>
      </div>
    </div>
  );
}

function BoardAvatar({ name, photo, size = 56, ring = false }: { name: string; photo?: string; size?: number; ring?: boolean }) {
  const ringClass = ring ? "ring-4 ring-white/10" : "ring-1 ring-white/15";
  if (photo) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photo}
        alt={name}
        style={{ height: size, width: size }}
        className={`shrink-0 rounded-full object-cover ${ringClass}`}
      />
    );
  }
  const initials = name.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div
      style={{ height: size, width: size, fontSize: size * 0.36 }}
      className={`flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#2a6b40] to-[#92d6a1] font-black text-white ${ringClass}`}
    >
      {initials || "?"}
    </div>
  );
}

function EmptyBoardMessage() {
  return <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-10 text-center text-2xl font-semibold text-white/40">No production entries for this selection.</div>;
}
