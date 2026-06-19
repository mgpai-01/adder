"use client";

import { Expand, Factory, Medal, RefreshCw, Target, Trophy, Users } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
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

  return (
    <main
      className={`min-h-screen text-white ${cursorHidden ? "cursor-none" : ""}`}
      style={{
        backgroundImage:
          "radial-gradient(1200px 600px at 50% -15%, rgba(146,214,161,0.12), transparent 60%), linear-gradient(180deg, #0b1a16 0%, #06120f 60%, #050d0b 100%)"
      }}
    >
      <header className="border-b border-white/10 bg-white/[0.03] px-8 py-5 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-6">
          <div className="flex items-center gap-5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="Manufacturing Green Products" className="h-20 w-20 shrink-0 rounded-full bg-white ring-2 ring-[#92d6a1]/40" />
            <div>
              <h1 className="text-5xl font-black tracking-tight text-white">
                LIVE <span className="bg-gradient-to-r from-[#92d6a1] to-[#aef2bc] bg-clip-text text-transparent">PALLET TRACKER</span>
              </h1>
              <p className="mt-1 text-xl font-bold text-white/70">{periodLabel} · {clockLabel}</p>
              <span className="mt-2 inline-flex items-center gap-2 rounded-full bg-[#92d6a1]/15 px-4 py-1 text-lg font-black text-[#aef2bc]">
                {selectedLocationLabel} · {selectedShiftLabel}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button type="button" className="flex h-14 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-5 text-lg font-black text-white transition-colors hover:bg-white/10" onClick={() => loadData().catch(() => undefined)}>
              <RefreshCw size={22} />
              Refresh
            </button>
            <button type="button" className="flex h-14 items-center gap-2 rounded-xl bg-gradient-to-r from-[#2a6b40] to-[#3f8a55] px-5 text-lg font-black text-white shadow-lg shadow-[#2a6b40]/30 transition-transform hover:scale-[1.03]" onClick={enterFullscreen}>
              <Expand size={22} />
              Fullscreen
            </button>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
          {[
            <select key="loc" className="h-14 rounded-xl border border-white/15 bg-white/[0.06] px-4 text-lg font-black text-white" value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)}>
              <option className="text-steel-900" value="all">All Locations</option>
              {locations.map((location) => <option className="text-steel-900" key={location.id} value={location.id}>{location.name}</option>)}
            </select>,
            <select key="shift" className="h-14 rounded-xl border border-white/15 bg-white/[0.06] px-4 text-lg font-black text-white" value={shiftFilter} onChange={(event) => setShiftFilter(event.target.value)}>
              <option className="text-steel-900" value="all">All Shifts</option>
              {shifts.map((shift) => <option className="text-steel-900" key={shift} value={shift}>{shift}</option>)}
            </select>,
            <select key="period" className="h-14 rounded-xl border border-white/15 bg-white/[0.06] px-4 text-lg font-black text-white" value={periodMode} onChange={(event) => setPeriodMode(event.target.value as PeriodMode)}>
              <option className="text-steel-900" value="today">Today</option>
              <option className="text-steel-900" value="date">Specific Date</option>
              <option className="text-steel-900" value="current-week">Current Week</option>
              <option className="text-steel-900" value="previous-week">Previous Week</option>
              <option className="text-steel-900" value="custom-week">Custom Week</option>
            </select>,
            <input key="date" className="h-14 rounded-xl border border-white/15 bg-white/[0.06] px-4 text-lg font-black text-white" type="date" value={periodMode === "custom-week" ? selectedWeek : selectedDate} onChange={(event) => periodMode === "custom-week" ? setSelectedWeek(getWeekKey(event.target.value)) : setSelectedDate(event.target.value)} disabled={periodMode !== "date" && periodMode !== "custom-week"} />,
            <button key="rot" type="button" className="h-14 rounded-xl border border-white/15 bg-white/[0.06] px-4 text-lg font-black text-white" onClick={() => setRotationEnabled((value) => !value)}>
              Rotation: {rotationEnabled ? "On" : "Off"}
            </button>
          ]}
        </div>
      </header>

      <section className="grid min-h-[calc(100vh-245px)] gap-6 p-8">
        {rotationScreen === 0 && (
          <div className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
            <BoardPanel title="LIVE RANKING" icon={<Trophy size={34} className="text-[#92d6a1]" />}>
              <div className="grid gap-3">
                {repairerRows.slice(0, 12).map((row, index) => {
                  const top3 = index < 3;
                  const pct = Math.round((row.quantity / maxQuantity) * 100);
                  return (
                    <div key={row.employeeId} className={`relative overflow-hidden rounded-2xl border px-5 py-4 ${top3 ? "border-[#92d6a1]/40 bg-[#92d6a1]/[0.08]" : "border-white/10 bg-white/[0.04]"}`}>
                      <div className="relative z-10 flex items-center gap-4">
                        <div className="flex w-14 items-center justify-center">
                          {top3 ? <Medal size={40} className={index === 0 ? "text-[#aef2bc]" : index === 1 ? "text-slate-200" : "text-[#4aa666]"} /> : <span className="text-3xl font-black text-white/40">{index + 1}</span>}
                        </div>
                        <span className="flex-1 truncate text-4xl font-black">{row.name}</span>
                        <span className="text-5xl font-black tabular-nums text-[#aef2bc]">{wholeNumber(row.quantity)}</span>
                      </div>
                      <div className="absolute inset-x-0 bottom-0 h-1.5 bg-white/5">
                        <div className="h-full bg-gradient-to-r from-[#2a6b40] to-[#92d6a1] transition-all duration-700" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
                {repairerRows.length === 0 && <EmptyBoardMessage />}
              </div>
            </BoardPanel>
            <div className="grid gap-6">
              <GrandTotal total={companyTotal} />
              <GoalTracker actual={companyTotal} goal={goal} percent={goalPercent} />
            </div>
          </div>
        )}

        {rotationScreen === 1 && (
          <div className="grid gap-6 xl:grid-cols-2">
            <BoardPanel title="LOCATION TOTALS" icon={<Factory size={34} className="text-[#92d6a1]" />}>
              <div className="grid gap-5">
                {locationRows.map((location) => {
                  const pct = Math.round((location.quantity / (locationRows[0]?.quantity || 1)) * 100);
                  return (
                    <div key={location.id} className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] px-8 py-7">
                      <div className="flex items-center justify-between">
                        <span className="text-5xl font-black">{location.name}</span>
                        <span className="text-6xl font-black tabular-nums text-[#aef2bc]">{wholeNumber(location.quantity)}</span>
                      </div>
                      <div className="absolute inset-x-0 bottom-0 h-1.5 bg-white/5">
                        <div className="h-full bg-gradient-to-r from-[#2a6b40] to-[#92d6a1] transition-all duration-700" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
                {locationRows.length === 0 && <EmptyBoardMessage />}
              </div>
            </BoardPanel>
            <div className="grid gap-6">
              <GoalTracker actual={companyTotal} goal={goal} percent={goalPercent} />
              <GrandTotal total={companyTotal} />
            </div>
          </div>
        )}

        {rotationScreen === 2 && (
          <BoardPanel title="REPAIRER DETAIL" icon={<Users size={34} className="text-[#92d6a1]" />}>
            <div className="overflow-hidden rounded-2xl border border-white/10">
              <table className="w-full text-left">
                <thead className="bg-[#92d6a1]/10 text-2xl uppercase text-[#aef2bc]">
                  <tr>
                    <th className="p-4">Rank</th>
                    <th className="p-4">Repairer</th>
                    <th className="p-4">Location</th>
                    <th className="p-4">Shift</th>
                    <th className="p-4 text-right">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {repairerRows.map((row, index) => (
                    <tr key={row.employeeId} className={`border-t border-white/10 text-3xl font-black ${index % 2 === 0 ? "bg-white/[0.03]" : "bg-transparent"}`}>
                      <td className="p-4 text-white/40">{index + 1}</td>
                      <td className="p-4">{row.name}</td>
                      <td className="p-4 text-white/70">{getLocationName(row.locationId)}</td>
                      <td className="p-4 text-white/70">{row.shift}</td>
                      <td className="p-4 text-right text-4xl tabular-nums text-[#aef2bc]">{wholeNumber(row.quantity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {repairerRows.length === 0 && <EmptyBoardMessage />}
            </div>
          </BoardPanel>
        )}
      </section>

      <footer className="fixed bottom-0 left-0 right-0 flex items-center justify-between border-t border-white/10 bg-white/[0.03] px-8 py-3 text-lg font-bold text-white/50 backdrop-blur">
        <span>Auto-refresh every 15 seconds · Screen {rotationScreen + 1} of 3</span>
        <span>{lastUpdated ? `Last updated ${lastUpdated.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })}` : "Loading production data..."}</span>
      </footer>
    </main>
  );
}

function BoardPanel({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 shadow-2xl backdrop-blur">
      <div className="mb-5 flex items-center gap-3 border-b border-white/10 pb-4">
        {icon}
        <h2 className="text-3xl font-black tracking-wide text-white">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function GrandTotal({ total }: { total: number }) {
  return (
    <div className="relative flex flex-col items-center justify-center overflow-hidden rounded-3xl border border-[#92d6a1]/30 bg-gradient-to-b from-[#92d6a1]/[0.14] to-transparent p-8 text-center">
      <span className="text-2xl font-black uppercase tracking-[0.2em] text-[#aef2bc]">Company Total</span>
      <strong className="mt-2 bg-gradient-to-b from-white to-[#cfeed8] bg-clip-text text-8xl font-black tabular-nums text-transparent">{wholeNumber(total)}</strong>
      <span className="mt-1 text-2xl font-black uppercase tracking-[0.2em] text-white/50">Pallets</span>
    </div>
  );
}

function GoalTracker({ actual, goal, percent }: { actual: number; goal: number; percent: number }) {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-8">
      <div className="flex items-center gap-3">
        <Target size={36} className="text-[#92d6a1]" />
        <h2 className="text-3xl font-black">TODAY&apos;S GOAL</h2>
      </div>
      <div className="mt-6 flex items-center justify-center gap-8">
        <div className="relative h-44 w-44">
          <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
            <circle cx="60" cy="60" r={radius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="12" />
            <circle cx="60" cy="60" r={radius} fill="none" stroke="#92d6a1" strokeWidth="12" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - percent / 100)} className="transition-all duration-700" />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-5xl font-black tabular-nums text-[#aef2bc]">{percent}%</span>
          </div>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-white/50">Progress</p>
          <p className="text-4xl font-black tabular-nums">{wholeNumber(actual)}</p>
          <p className="text-2xl font-bold text-white/40">of {wholeNumber(goal)}</p>
        </div>
      </div>
    </div>
  );
}

function EmptyBoardMessage() {
  return <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center text-3xl font-black text-white/50">No production entries for this selection.</div>;
}
