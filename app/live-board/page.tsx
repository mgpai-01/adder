"use client";

import { Crown, Expand, MapPin, RefreshCw, Target, Trophy } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { employees, locations, palletTypes, payrollSettings, shifts } from "@/lib/data";
import { findPalletType } from "@/lib/payroll";
import { getWeekKey, wholeNumber } from "@/lib/payroll";
import { LanguageProvider, translate, useT, type Language } from "@/lib/i18n";
import type { DailyEntry, PayrollSettings, Shift } from "@/lib/types";
import CalendarField, { type DateSelection } from "@/components/CalendarField";

type PeriodMode = "today" | "date" | "current-week" | "previous-week" | "custom-week" | "custom-range";

const refreshInterval = 60_000;

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
  // QC deductions (quality reductions) subtract from the pallet count shown on
  // the board — a rejected pallet lowers the productivity total.
  return (entry.lines ?? []).reduce((total, line) => {
    if (findPalletType(palletTypes, line.palletTypeId)?.category === "QC Deductions") return total - Number(line.quantity || 0);
    return total + Number(line.quantity || 0);
  }, 0);
}

// Short readable name for a pallet type, e.g. "3 STACKER · REGULAR" or "REPAIR
// · 60x40", used to list exactly which pallets a repairer built.
function palletLabel(palletTypeId: string) {
  const pallet = findPalletType(palletTypes, palletTypeId);
  if (!pallet) return palletTypeId.replaceAll("-", " ");
  const description = pallet.description && !pallet.code.toUpperCase().includes(pallet.description.toUpperCase()) ? ` · ${pallet.description}` : "";
  return `${pallet.code}${description}`.trim();
}

function readUrlFilters() {
  if (typeof window === "undefined") {
    return {
      location: "all",
      shift: "all",
      period: "today" as PeriodMode,
      date: getToday(),
      week: getWeekKey(getToday()),
      rangeStart: getToday(),
      rangeEnd: getToday()
    };
  }

  const params = new URLSearchParams(window.location.search);
  const locationParam = params.get("location") ?? "all";
  const matchedLocation = locations.find((location) => location.name.toLowerCase() === locationParam.toLowerCase() || location.id === locationParam);
  const shiftParam = params.get("shift") ?? "all";
  const periodParam = params.get("period") as PeriodMode | null;
  const dateParam = params.get("date") ?? getToday();
  const weekParam = params.get("week") ?? getWeekKey(getToday());
  const fromParam = params.get("from") ?? getToday();
  const toParam = params.get("to") ?? getToday();

  return {
    location: matchedLocation?.id ?? "all",
    shift: shifts.includes(shiftParam as Shift) ? shiftParam : "all",
    period:
      periodParam ??
      (params.has("from") || params.has("to")
        ? "custom-range"
        : params.has("date")
          ? "date"
          : params.has("week")
            ? "custom-week"
            : "today"),
    date: dateParam,
    week: getWeekKey(weekParam),
    rangeStart: fromParam,
    rangeEnd: toParam
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
  const [rangeStart, setRangeStart] = useState(initialFilters.rangeStart);
  const [rangeEnd, setRangeEnd] = useState(initialFilters.rangeEnd);
  const [now, setNow] = useState(new Date());
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [cursorHidden, setCursorHidden] = useState(false);
  // The board is shown publicly; default to English with an option to switch to
  // Spanish. The choice is remembered separately from the manager-app language.
  const [language, setLanguage] = useState<Language>("en");
  useEffect(() => {
    const stored = window.localStorage.getItem("mgp-board-language");
    if (stored === "en" || stored === "es") setLanguage(stored);
  }, []);
  function changeLanguage(next: Language) {
    setLanguage(next);
    try {
      window.localStorage.setItem("mgp-board-language", next);
    } catch {
      // ignore storage errors
    }
  }
  const t = (text: string, vars?: Record<string, string | number>) => translate(language, text, vars);
  const dateLocale = language === "es" ? "es-ES" : "en-US";
  const [roster, setRoster] = useState<Record<string, { name: string; photo?: string }>>({});
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / 1920, window.innerHeight / 1080));
    fit();
    window.addEventListener("resize", fit);
    document.addEventListener("fullscreenchange", fit);
    return () => {
      window.removeEventListener("resize", fit);
      document.removeEventListener("fullscreenchange", fit);
    };
  }, []);

  async function loadData() {
    // Use the photo-free summary endpoints: the board only needs names and
    // pallet quantities, so pulling the embedded photos every refresh would
    // burn Supabase egress for nothing.
    const [entryResponse, settingsResponse, employeesResponse] = await Promise.all([
      fetch("/api/entries/summary", { cache: "no-store" }),
      fetch("/api/settings", { cache: "no-store" }),
      fetch("/api/employees?summary=1", { cache: "no-store" })
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
    if (periodMode === "custom-range") {
      params.set("from", rangeStart);
      params.set("to", rangeEnd);
    }
    const query = params.toString();
    window.history.replaceState(null, "", query ? `/live-board?${query}` : "/live-board");
  }, [locationFilter, periodMode, selectedDate, selectedWeek, rangeStart, rangeEnd, shiftFilter]);

  const filteredEntries = useMemo(() => {
    const today = getToday();
    const currentWeek = getWeekKey(today);
    const previousWeek = addDays(currentWeek, -7);
    const weekStart = periodMode === "previous-week" ? previousWeek : periodMode === "custom-week" ? selectedWeek : currentWeek;
    const weekEnd = addDays(weekStart, 6);
    // A custom range can be entered in either order; sort the two ends so the
    // earlier date is always the start.
    const [rangeFrom, rangeTo] = rangeStart <= rangeEnd ? [rangeStart, rangeEnd] : [rangeEnd, rangeStart];

    return entries.filter((entry) => {
      if (locationFilter !== "all" && entry.locationId !== locationFilter) return false;
      if (shiftFilter !== "all" && entry.shift !== shiftFilter) return false;
      if (periodMode === "today" && entry.date !== today) return false;
      if (periodMode === "date" && entry.date !== selectedDate) return false;
      if ((periodMode === "current-week" || periodMode === "previous-week" || periodMode === "custom-week") && (entry.date < weekStart || entry.date > weekEnd)) return false;
      if (periodMode === "custom-range" && (entry.date < rangeFrom || entry.date > rangeTo)) return false;
      return true;
    });
  }, [entries, locationFilter, periodMode, selectedDate, selectedWeek, rangeStart, rangeEnd, shiftFilter]);

  const repairerRows = useMemo(() => {
    type Acc = { employeeId: string; name: string; photo?: string; locationId: string; shift: Shift; quantity: number; palletMap: Map<string, { id: string; label: string; quantity: number }> };
    const totals = new Map<string, Acc>();
    for (const entry of filteredEntries) {
      const row = totals.get(entry.employeeId) ?? {
        employeeId: entry.employeeId,
        name: roster[entry.employeeId]?.name ?? getEmployeeName(entry.employeeId),
        photo: roster[entry.employeeId]?.photo,
        locationId: entry.locationId,
        shift: entry.shift,
        quantity: 0,
        palletMap: new Map<string, { id: string; label: string; quantity: number }>()
      };
      row.quantity += quantityForEntry(entry);
      // Tally the specific pallet types this repairer produced (QC deductions
      // aren't pallets they "made", so they're left out of the breakdown).
      for (const line of entry.lines ?? []) {
        const pallet = findPalletType(palletTypes, line.palletTypeId);
        if (pallet?.category === "QC Deductions") continue;
        const quantity = Number(line.quantity || 0);
        if (!quantity) continue;
        const key = pallet?.id ?? line.palletTypeId;
        const existing = row.palletMap.get(key) ?? { id: key, label: palletLabel(line.palletTypeId), quantity: 0 };
        existing.quantity += quantity;
        row.palletMap.set(key, existing);
      }
      totals.set(entry.employeeId, row);
    }
    return Array.from(totals.values())
      .map(({ palletMap, ...row }) => ({ ...row, pallets: Array.from(palletMap.values()).sort((a, b) => b.quantity - a.quantity) }))
      .sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name));
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

  // Each yard as its own column of ranked repairers, for the "All Yards" grid.
  // Fixed location order so tiles don't jump around as counts change live.
  const yardColumns = useMemo(
    () =>
      locations
        .filter((location) => locationFilter === "all" || location.id === locationFilter)
        .map((location) => {
          const rows = repairerRows.filter((row) => row.locationId === location.id);
          return { id: location.id, name: location.name, total: rows.reduce((sum, row) => sum + row.quantity, 0), rows };
        }),
    [repairerRows, locationFilter]
  );

  const companyTotal = repairerRows.reduce((total, row) => total + row.quantity, 0);
  const goal = Math.max(0, settings.dailyProductionGoal || 4500);
  const goalPercent = goal > 0 ? Math.min(100, Math.round((companyTotal / goal) * 100)) : 0;
  const selectedLocationLabel = locationFilter === "all" ? t("All Locations") : getLocationName(locationFilter);
  const selectedShiftLabel = shiftFilter === "all" ? t("All Shifts") : t("{shift} Shift", { shift: shiftFilter });
  const periodLabel =
    periodMode === "today"
      ? new Intl.DateTimeFormat(dateLocale, { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(now)
      : periodMode === "date"
        ? new Intl.DateTimeFormat(dateLocale, { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date(`${selectedDate}T12:00:00`))
        : periodMode === "custom-range"
          ? (() => {
              const [from, to] = rangeStart <= rangeEnd ? [rangeStart, rangeEnd] : [rangeEnd, rangeStart];
              const fmt = new Intl.DateTimeFormat(dateLocale, { month: "short", day: "numeric", year: "numeric" });
              return from === to
                ? fmt.format(new Date(`${from}T12:00:00`))
                : `${fmt.format(new Date(`${from}T12:00:00`))} – ${fmt.format(new Date(`${to}T12:00:00`))}`;
            })()
          : `${periodMode === "previous-week" ? t("Previous Week") : t("Week")} ${t("of {goal}", { goal: new Intl.DateTimeFormat(dateLocale, { month: "long", day: "numeric", year: "numeric" }).format(new Date(`${periodMode === "custom-week" ? selectedWeek : getWeekKey(getToday())}T12:00:00`)) })}`;

  async function enterFullscreen() {
    await document.documentElement.requestFullscreen?.();
  }

  const maxQuantity = repairerRows[0]?.quantity || 1;
  const clockLabel = now.toLocaleTimeString(dateLocale, { hour: "numeric", minute: "2-digit" });
  const control = "h-11 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-base font-semibold text-white/90 outline-none backdrop-blur";

  // The date box mirrors periodMode so the calendar shows whatever is active,
  // and writing a selection back updates the matching custom mode.
  const boardToday = getToday();
  const boardCurrentWeek = getWeekKey(boardToday);
  const boardPreviousWeek = addDays(boardCurrentWeek, -7);
  const calendarValue: DateSelection =
    periodMode === "date"
      ? { mode: "day", start: selectedDate, end: selectedDate }
      : periodMode === "current-week"
        ? { mode: "week", start: boardCurrentWeek, end: addDays(boardCurrentWeek, 6) }
        : periodMode === "previous-week"
          ? { mode: "week", start: boardPreviousWeek, end: addDays(boardPreviousWeek, 6) }
          : periodMode === "custom-week"
            ? { mode: "week", start: selectedWeek, end: addDays(selectedWeek, 6) }
            : periodMode === "custom-range"
              ? { mode: "range", start: rangeStart, end: rangeEnd }
              : { mode: "day", start: boardToday, end: boardToday };
  const presetButton = (mode: PeriodMode) =>
    `${control} px-4 ${periodMode === mode ? "!border-white/40 !bg-white/15 text-white" : ""}`;

  return (
    <LanguageProvider value={{ language, setLanguage: changeLanguage, t }}>
    <main
      className={`fixed inset-0 flex items-center justify-center overflow-hidden text-white ${cursorHidden ? "cursor-none" : ""}`}
      style={{
        fontFamily: "ui-sans-serif, system-ui, -apple-system, 'SF Pro Display', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        background:
          "radial-gradient(rgba(255,255,255,0.045) 1px, transparent 1px) 0 0 / 24px 24px, linear-gradient(180deg, #0b1512 0%, #060d0a 100%)"
      }}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <span className="absolute -left-40 -top-32 h-[42rem] w-[42rem] rounded-full bg-[#2a6b40]/30 blur-[130px] [animation:aurora-a_20s_ease-in-out_infinite]" />
        <span className="absolute -bottom-40 -right-40 h-[40rem] w-[40rem] rounded-full bg-[#92d6a1]/18 blur-[130px] [animation:aurora-b_24s_ease-in-out_infinite]" />
        <span className="absolute bottom-0 left-1/3 h-[30rem] w-[30rem] rounded-full bg-[#3f8a55]/15 blur-[120px] [animation:aurora-c_28s_ease-in-out_infinite]" />
      </div>
      <div
        className="relative flex flex-col overflow-hidden"
        style={{ width: 1920, height: 1080, transform: `scale(${scale})`, transformOrigin: "center" }}
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
                {t("Live")} <span className="bg-gradient-to-r from-[#92d6a1] to-[#aef2bc] bg-clip-text text-transparent">{t("Pallet Tracker")}</span>
              </h1>
              <span className="flex items-center gap-1.5 rounded-full border border-[#92d6a1]/40 bg-[#92d6a1]/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.2em] text-[#aef2bc]">
                <span className="h-2 w-2 rounded-full bg-[#92d6a1] [animation:board-pulse-dot_1.6s_ease-in-out_infinite]" />
                {t("Live")}
              </span>
            </div>
            <p className="mt-1.5 text-lg font-medium text-white/50 2xl:text-xl">{periodLabel} · {clockLabel} · {selectedLocationLabel} · {selectedShiftLabel}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-xl border border-white/10 text-sm font-bold">
            {(["en", "es"] as Language[]).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => changeLanguage(code)}
                className={`px-3 py-2.5 ${language === code ? "bg-gradient-to-r from-[#2a6b40] to-[#3f8a55] text-white" : "bg-white/[0.05] text-white/60 hover:text-white"}`}
              >
                {code.toUpperCase()}
              </button>
            ))}
          </div>
          <button type="button" aria-label="Refresh" className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05] text-white/70 backdrop-blur transition-colors hover:text-white" onClick={() => loadData().catch(() => undefined)}>
            <RefreshCw size={20} />
          </button>
          <button type="button" className="flex h-12 items-center gap-2 rounded-xl bg-gradient-to-r from-[#2a6b40] to-[#3f8a55] px-5 font-bold text-white shadow-lg shadow-[#2a6b40]/25 transition-transform hover:scale-[1.03]" onClick={enterFullscreen}>
            <Expand size={20} />
            {t("Fullscreen")}
          </button>
        </div>
      </header>

      <div className="flex shrink-0 px-10 pt-4">
        <div className="flex flex-wrap gap-1 rounded-2xl border border-white/10 bg-white/[0.04] p-1.5 backdrop-blur">
          <YardTab active={locationFilter === "all"} onClick={() => setLocationFilter("all")}>{t("All Yards")}</YardTab>
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
            <option className="text-steel-900" value="all">{t("All Shifts")}</option>
            {shifts.map((shift) => <option className="text-steel-900" key={shift} value={shift}>{shift}</option>)}
          </select>
          <button type="button" className={presetButton("today")} onClick={() => setPeriodMode("today")}>{t("Today")}</button>
          <button type="button" className={presetButton("current-week")} onClick={() => setPeriodMode("current-week")}>{t("Current Week")}</button>
          <button type="button" className={presetButton("previous-week")} onClick={() => setPeriodMode("previous-week")}>{t("Previous Week")}</button>
          <CalendarField
            className={`${control} min-w-[12rem]`}
            value={calendarValue}
            onChange={(selection) => {
              if (selection.mode === "day") {
                setSelectedDate(selection.start);
                setPeriodMode("date");
              } else if (selection.mode === "week") {
                setSelectedWeek(getWeekKey(selection.start));
                setPeriodMode("custom-week");
              } else {
                setRangeStart(selection.start);
                setRangeEnd(selection.end);
                setPeriodMode("custom-range");
              }
            }}
          />
        </div>
      )}

      <section className="min-h-0 flex-1 overflow-hidden px-10 pb-5 pt-3">
        <div className="grid h-full gap-6 xl:grid-cols-[1.5fr_0.9fr]">
          <GlassCard className="flex min-h-0 flex-col">
            <SectionLabel icon={<Trophy size={22} />}>{locationFilter === "all" ? t("Yards") : t("Ranking")}</SectionLabel>
            {repairerRows.length === 0 ? (
              <EmptyBoardMessage />
            ) : locationFilter === "all" ? (
              <div
                className="grid min-h-0 flex-1 gap-4 overflow-hidden"
                style={{ gridTemplateColumns: `repeat(${Math.max(yardColumns.length, 1)}, minmax(0, 1fr))` }}
              >
                {yardColumns.map((yard) => (
                  <YardColumn key={yard.id} yard={yard} />
                ))}
              </div>
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

          <div className="grid min-h-0 grid-rows-[auto_auto_1fr] gap-5">
            <GrandTotal total={companyTotal} />
            <GoalTracker actual={companyTotal} goal={goal} percent={goalPercent} />
            <GlassCard className="flex min-h-0 flex-col">
              <SectionLabel icon={<MapPin size={22} />}>{t("Location Totals")}</SectionLabel>
              <div
                className="grid min-h-0 flex-1 gap-3 overflow-hidden"
                style={{ gridTemplateRows: `repeat(${Math.max(locationRows.length, 1)}, minmax(0, 1fr))` }}
              >
                {locationRows.map((location) => {
                  const pct = Math.round((location.quantity / (locationRows[0]?.quantity || 1)) * 100);
                  return (
                    <div key={location.id} className="flex min-h-0 flex-col justify-center rounded-2xl border border-white/10 bg-white/[0.03] px-6 py-3">
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
        <span>{t("Live · auto-refresh")}</span>
        <span>{lastUpdated ? t("Last updated {time}", { time: lastUpdated.toLocaleTimeString(dateLocale, { hour: "numeric", minute: "2-digit", second: "2-digit" }) }) : t("Loading…")}</span>
      </footer>
      </div>
    </main>
    </LanguageProvider>
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
  return (
    <div className={`relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.045] p-7 shadow-[0_14px_50px_rgba(0,0,0,0.5)] backdrop-blur-xl ${className}`}>
      <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
      {children}
    </div>
  );
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

type BoardRow = { employeeId: string; name: string; photo?: string; locationId: string; shift: Shift; quantity: number; pallets?: { id: string; label: string; quantity: number }[] };

function YardColumn({ yard }: { yard: { id: string; name: string; total: number; rows: BoardRow[] } }) {
  const { t } = useT();
  const max = yard.rows[0]?.quantity || 1;
  return (
    <div className="flex min-h-0 flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-3 flex items-end justify-between gap-2 border-b border-white/10 pb-3">
        <span className="text-xl font-black leading-tight">{yard.name}</span>
        <div className="flex shrink-0 items-baseline gap-1.5">
          <span className="text-2xl font-black tabular-nums text-[#aef2bc]">{wholeNumber(yard.total)}</span>
          <span className="text-xs font-bold uppercase tracking-wide text-white/35">{t("pallets")}</span>
        </div>
      </div>
      {yard.rows.length === 0 ? (
        <p className="pt-8 text-center text-lg font-semibold text-white/30">{t("No production yet")}</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden">
          {yard.rows.map((row, index) => (
            <div key={row.employeeId} className="flex items-start gap-2.5">
              <span className="w-5 shrink-0 pt-1 text-center text-base font-bold tabular-nums text-white/30">{index + 1}</span>
              <BoardAvatar name={row.name} photo={row.photo} size={36} />
              <div className="min-w-0 flex-1">
                <span className="block text-base font-bold leading-tight [overflow-wrap:anywhere]">{row.name}</span>
                {row.pallets && row.pallets.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {row.pallets.map((pallet) => (
                      <span key={pallet.id} className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[11px] font-semibold leading-tight text-white/55">
                        {pallet.label} <span className="tabular-nums text-white/85">{wholeNumber(pallet.quantity)}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <span className="shrink-0 pt-0.5 text-xl font-black tabular-nums">{wholeNumber(row.quantity)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

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
  const { t } = useT();
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
        {rank === 1 ? t("Leader") : rank === 2 ? t("2nd") : t("3rd")}
      </span>
      {isFirst && <Crown size={30} className="mb-1 text-[#aef2bc]" />}
      <BoardAvatar name={row.name} photo={row.photo} size={isFirst ? 104 : 80} ring />
      <span className={`mt-4 w-full truncate font-bold ${isFirst ? "text-3xl" : "text-2xl"}`}>{row.name}</span>
      <span className={`mt-1 font-black tabular-nums ${isFirst ? "bg-gradient-to-b from-white to-[#aef2bc] bg-clip-text text-7xl text-transparent" : "text-6xl text-[#aef2bc]"}`}>{wholeNumber(row.quantity)}</span>
      <span className="text-sm font-bold uppercase tracking-[0.2em] text-white/35">{t("pallets")}</span>
    </div>
  );
}

function GrandTotal({ total }: { total: number }) {
  const { t } = useT();
  const shown = useCountUp(total);
  return (
    <div className="relative overflow-hidden rounded-3xl border border-[#92d6a1]/25 bg-gradient-to-b from-[#92d6a1]/[0.12] to-white/[0.02] p-6 text-center shadow-[0_14px_50px_rgba(0,0,0,0.45)] backdrop-blur-xl">
      <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#92d6a1]/40 to-transparent" />
      <span className="pointer-events-none absolute left-1/2 top-1/2 h-40 w-40 -translate-x-1/2 -translate-y-1/3 rounded-full bg-[#92d6a1]/20 blur-3xl" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.svg" alt="" className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 opacity-[0.05]" />
      <span className="relative text-sm font-black uppercase tracking-[0.25em] text-[#aef2bc]">{t("Company Total")}</span>
      <p className="relative mt-2 bg-gradient-to-b from-white to-[#bdecca] bg-clip-text text-7xl font-black tabular-nums text-transparent">{wholeNumber(shown)}</p>
      <span className="relative mt-1 block text-base font-bold uppercase tracking-[0.2em] text-white/45">{t("Pallets")}</span>
    </div>
  );
}

function GoalTracker({ actual, goal, percent }: { actual: number; goal: number; percent: number }) {
  const { t } = useT();
  const radius = 56;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.045] p-6 shadow-[0_14px_50px_rgba(0,0,0,0.45)] backdrop-blur-xl">
      <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
      <div className="flex items-center gap-2.5">
        <Target size={22} className="text-[#92d6a1]" />
        <h2 className="text-xl font-black uppercase tracking-[0.2em] text-white/80">{t("Today's Goal")}</h2>
      </div>
      <div className="mt-4 flex items-center justify-center gap-8">
        <div className="relative h-36 w-36">
          <svg viewBox="0 0 130 130" className="h-full w-full -rotate-90">
            <defs>
              <linearGradient id="goalGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#2a6b40" />
                <stop offset="1" stopColor="#aef2bc" />
              </linearGradient>
            </defs>
            <circle cx="65" cy="65" r={radius} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="9" />
            <circle cx="65" cy="65" r={radius} fill="none" stroke="url(#goalGrad)" strokeWidth="9" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - percent / 100)} className="transition-all duration-700" style={{ filter: "drop-shadow(0 0 6px rgba(146,214,161,0.45))" }} />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-5xl font-black tabular-nums">{percent}%</span>
          </div>
        </div>
        <div className="text-right">
          <p className="text-4xl font-black tabular-nums">{wholeNumber(actual)}</p>
          <p className="text-base font-semibold text-white/40">{t("of {goal}", { goal: wholeNumber(goal) })}</p>
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
  const { t } = useT();
  return <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-10 text-center text-2xl font-semibold text-white/40">{t("No production entries for this selection.")}</div>;
}
