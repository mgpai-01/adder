"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useT } from "@/lib/i18n";

// A single date control that replaces the old scattered date inputs. It shows
// one box; tapping it opens a calendar. Behaviour:
//   • tap a day                -> that single day
//   • tap a second day         -> a custom range between the two taps
//   • "Weekly" button ON       -> tapping a day selects that whole Mon–Sun week
// `single` limits it to one-day selection (used for the entry/record date).
// `lockWeek` forces week selection (used by the weekly report control).
export type DateSelection = {
  mode: "day" | "week" | "range";
  start: string; // YYYY-MM-DD ("" = nothing selected)
  end: string; // YYYY-MM-DD (equals start for a single day)
};

function pad(value: number) {
  return value < 10 ? `0${value}` : `${value}`;
}
function toKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
function parseKey(key: string) {
  return new Date(`${key}T12:00:00`);
}
function todayKey() {
  return toKey(new Date());
}
// Monday of the week that `key` falls in (weeks run Monday–Sunday).
function mondayOf(key: string) {
  const date = parseKey(key);
  const day = date.getDay();
  date.setDate(date.getDate() + (day === 0 ? -6 : 1 - day));
  return toKey(date);
}
function addDaysKey(key: string, days: number) {
  const date = parseKey(key);
  date.setDate(date.getDate() + days);
  return toKey(date);
}

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

export default function CalendarField({
  value,
  onChange,
  single = false,
  lockWeek = false,
  allowClear = false,
  disabled = false,
  placeholder,
  className,
  align = "left"
}: {
  value: DateSelection;
  onChange: (value: DateSelection) => void;
  single?: boolean;
  lockWeek?: boolean;
  allowClear?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  align?: "left" | "right";
}) {
  const { t, language } = useT();
  const [open, setOpen] = useState(false);
  const [weekly, setWeekly] = useState(lockWeek || value.mode === "week");
  // Anchor for a two-tap custom range (the first day tapped, awaiting a second).
  const [anchor, setAnchor] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const base = value.start || todayKey();
  const [viewYear, setViewYear] = useState(parseKey(base).getFullYear());
  const [viewMonth, setViewMonth] = useState(parseKey(base).getMonth());

  // When opening, jump the calendar to the current selection and reset any
  // half-finished range.
  useEffect(() => {
    if (!open) return;
    const focus = parseKey(value.start || todayKey());
    setViewYear(focus.getFullYear());
    setViewMonth(focus.getMonth());
    setAnchor(null);
    if (!lockWeek) setWeekly(value.mode === "week");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const locale = language === "es" ? "es-ES" : "en-US";
  function fmt(key: string, opts: Intl.DateTimeFormatOptions) {
    return parseKey(key).toLocaleDateString(locale, opts);
  }

  const label = (() => {
    if (!value.start) return placeholder ?? t("Any date");
    if (value.mode === "day") return fmt(value.start, { month: "short", day: "numeric", year: "numeric" });
    if (value.mode === "week") return `${t("Week of")} ${fmt(value.start, { month: "short", day: "numeric" })}`;
    return `${fmt(value.start, { month: "short", day: "numeric" })} – ${value.end ? fmt(value.end, { month: "short", day: "numeric" }) : "…"}`;
  })();

  function pick(key: string) {
    if (single) {
      onChange({ mode: "day", start: key, end: key });
      setOpen(false);
      return;
    }
    if (weekly) {
      const monday = mondayOf(key);
      onChange({ mode: "week", start: monday, end: addDaysKey(monday, 6) });
      setOpen(false);
      return;
    }
    if (!anchor) {
      // First tap: provisional single day; a second tap turns it into a range.
      setAnchor(key);
      onChange({ mode: "day", start: key, end: key });
      return;
    }
    const [start, end] = key < anchor ? [key, anchor] : [anchor, key];
    onChange({ mode: "range", start, end });
    setAnchor(null);
    setOpen(false);
  }

  function shiftMonth(delta: number) {
    let month = viewMonth + delta;
    let year = viewYear;
    if (month < 0) {
      month = 11;
      year -= 1;
    } else if (month > 11) {
      month = 0;
      year += 1;
    }
    setViewMonth(month);
    setViewYear(year);
  }

  // Build the month grid (Monday-first).
  const firstOfMonth = new Date(viewYear, viewMonth, 1);
  const lead = (firstOfMonth.getDay() + 6) % 7;
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < lead; i += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) cells.push(`${viewYear}-${pad(viewMonth + 1)}-${pad(day)}`);

  function cellState(key: string): "single" | "start" | "end" | "mid" | "none" {
    const { mode, start, end } = value;
    if (!start) return "none";
    if (mode === "day") return key === start ? "single" : "none";
    if (key === start && key === end) return "single";
    if (key === start) return "start";
    if (key === end) return "end";
    if (key > start && key < end) return "mid";
    return "none";
  }

  const today = todayKey();
  const showWeeklyToggle = !single && !lockWeek;

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        className={className ?? "field"}
        style={{ display: "flex", alignItems: "center", gap: "0.5rem", textAlign: "left" }}
      >
        <CalendarDays size={16} className="shrink-0 opacity-70" />
        <span className="truncate">{label}</span>
      </button>

      {open && (
        <div
          className={
            "absolute z-50 mt-2 w-[19rem] rounded-xl border border-steel-200 bg-white p-3 text-steel-900 shadow-2xl " +
            (align === "right" ? "right-0" : "left-0")
          }
        >
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              aria-label="Previous month"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-steel-700 hover:bg-steel-100"
              onClick={() => shiftMonth(-1)}
            >
              <ChevronLeft size={18} />
            </button>
            <span className="text-sm font-black">
              {new Date(viewYear, viewMonth, 1).toLocaleDateString(locale, { month: "long", year: "numeric" })}
            </span>
            <button
              type="button"
              aria-label="Next month"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-steel-700 hover:bg-steel-100"
              onClick={() => shiftMonth(1)}
            >
              <ChevronRight size={18} />
            </button>
          </div>

          <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[0.65rem] font-black uppercase text-steel-400">
            {WEEKDAYS.map((weekday) => (
              <span key={weekday}>{weekday}</span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {cells.map((key, index) => {
              if (!key) return <span key={`blank-${index}`} />;
              const state = cellState(key);
              const day = Number(key.slice(8));
              const strong = state === "single" || state === "start" || state === "end";
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => pick(key)}
                  className={
                    "flex h-9 items-center justify-center rounded-lg text-sm font-bold transition-colors " +
                    (strong
                      ? "bg-workshop-500 text-white"
                      : state === "mid"
                        ? "bg-workshop-100 text-workshop-700"
                        : "text-steel-700 hover:bg-steel-100") +
                    (key === today && !strong ? " ring-1 ring-inset ring-workshop-500" : "")
                  }
                >
                  {day}
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {showWeeklyToggle && (
                <button
                  type="button"
                  onClick={() => {
                    setWeekly((prev) => !prev);
                    setAnchor(null);
                  }}
                  className={
                    "rounded-lg px-3 py-1.5 text-xs font-black transition-colors " +
                    (weekly ? "bg-workshop-500 text-white" : "bg-steel-100 text-steel-700 hover:bg-steel-200")
                  }
                >
                  {t("Weekly")}
                </button>
              )}
              {allowClear && (
                <button
                  type="button"
                  onClick={() => {
                    onChange({ mode: "day", start: "", end: "" });
                    setAnchor(null);
                    setOpen(false);
                  }}
                  className="rounded-lg bg-steel-100 px-3 py-1.5 text-xs font-black text-steel-700 hover:bg-steel-200"
                >
                  {t("Clear")}
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => pick(today)}
              className="rounded-lg px-3 py-1.5 text-xs font-black text-workshop-700 hover:bg-workshop-100"
            >
              {t("Today")}
            </button>
          </div>

          {showWeeklyToggle && !weekly && (
            <p className="mt-2 text-[0.65rem] font-bold leading-tight text-steel-400">{t("Tap one day, or tap two days for a range.")}</p>
          )}
        </div>
      )}
    </div>
  );
}
