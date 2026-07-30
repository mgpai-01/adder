import { defaultPalletTypes } from "./data";
import type { DailyEntry, EntryCalculation, PalletType, PayrollSettings } from "./types";

export function currency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(Number.isFinite(value) ? value : 0);
}

export function wholeNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0
  }).format(Number.isFinite(value) ? value : 0);
}

// The calendar date in the LOCAL time zone (not UTC).
export function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Entries saved before the date-rollover fix defaulted "today" to the UTC date,
// which flips to tomorrow at 5 PM Pacific — so evening entries were stamped with
// the next day (and Sunday-evening ones fell into the next week). The signature
// is exact: the saved date equals the UTC date of createdAt while the local date
// of createdAt is earlier. Returns the corrected date, or null when the entry
// isn't affected — so entries a supervisor deliberately back-dated are untouched.
export function correctedEntryDate(entry: Pick<DailyEntry, "date" | "createdAt">): string | null {
  if (!entry.createdAt) return null;
  const created = new Date(entry.createdAt);
  if (Number.isNaN(created.getTime())) return null;
  const utcDate = entry.createdAt.slice(0, 10);
  const localDate = formatLocalDate(created);
  return entry.date === utcDate && utcDate !== localDate ? localDate : null;
}

// Re-stamps a misdated entry onto the day the work actually happened. Applied
// wherever entries are loaded so every total groups by the real day without
// needing a data migration.
export function withCorrectedDate<T extends Pick<DailyEntry, "date" | "createdAt" | "dateCorrectedFrom">>(entry: T): T {
  const corrected = correctedEntryDate(entry);
  return corrected ? { ...entry, date: corrected, dateCorrectedFrom: entry.date } : entry;
}

// Entries whose date was corrected on load — i.e. the day shown is right but the
// stored row still carries the wrong date until the correction is written back.
export function findMisdatedEntries(entries: DailyEntry[]) {
  return entries.filter((entry) => Boolean(entry.dateCorrectedFrom));
}

// Repairers are listed alphabetically by last name. The surname is taken as the
// last word of the name, so "Alberto Arroyo Gomez" files under Gomez and a
// single-word name like "Rodolfo" files under itself.
export function lastNameKey(name: string) {
  return (name.trim().split(/\s+/).slice(-1)[0] ?? "").toLowerCase();
}

// Last name, then the full name so people who share a surname keep a stable,
// predictable order rather than swapping around between renders.
export function compareByLastName(a: string, b: string) {
  return lastNameKey(a).localeCompare(lastNameKey(b)) || a.localeCompare(b);
}

export function calculatePaidHours(entry: Pick<DailyEntry, "manualHours" | "breakProfile">) {
  if (entry.breakProfile === "paidLunch") {
    return entry.manualHours;
  }

  if (entry.breakProfile === "noLunch") {
    return entry.manualHours;
  }

  return Math.max(0, entry.manualHours - 0.5);
}

export function calculateWorkedHours(entry: Pick<DailyEntry, "manualHours" | "breakProfile">) {
  if (entry.breakProfile === "standard") {
    return Math.max(0, entry.manualHours - 0.5);
  }

  return entry.manualHours;
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Maps an old/default pallet id to the slug of its code+description. Entries
// saved under a built-in default id (e.g. "stacker-grade-a-1") then resolve to
// whichever pallet in the current list shares that code+description, so they
// keep working even after pallets were re-created with new (cloud) ids.
const defaultLabelSlugById = new Map(defaultPalletTypes.map((pallet) => [pallet.id, slugify(`${pallet.code} ${pallet.description}`)]));
const legacyPalletTypeAliases: Record<string, string> = {
  ...Object.fromEntries(defaultPalletTypes.map((pallet) => [pallet.id, defaultLabelSlugById.get(pallet.id)!])),
  "no-1": defaultLabelSlugById.get("stacker-grade-a-1") ?? "stacker-grade-a-1",
  "no-2": defaultLabelSlugById.get("stacker-grade-b-2") ?? "stacker-grade-b-2"
};

export function findPalletType(palletTypes: PalletType[], palletTypeId: string) {
  if (!palletTypeId) return undefined;
  const normalizedId = legacyPalletTypeAliases[palletTypeId] ?? palletTypeId;
  return palletTypes.find((pallet) => {
    const fullLabel = `${pallet.code} ${pallet.description}`.trim();
    return (
      pallet.id === normalizedId ||
      pallet.code === normalizedId ||
      slugify(pallet.code) === normalizedId ||
      slugify(fullLabel) === normalizedId
    );
  });
}

export function calculateEntry(
  entry: DailyEntry,
  palletTypes: PalletType[],
  settings: PayrollSettings
): EntryCalculation {
  const paidHours = calculatePaidHours(entry);
  const workedHours = calculateWorkedHours(entry);
  const overtimeHours = Math.max(0, paidHours - settings.dailyOvertimeThreshold);
  const regularHours = Math.max(0, paidHours - overtimeHours);
  const lines = entry.lines ?? [];
  const pieceEarnings = lines.reduce((total, line) => {
    const palletType = findPalletType(palletTypes, line.palletTypeId);
    return total + line.quantity * (palletType?.rate ?? 0);
  }, 0);
  // QC Deductions (quality reductions) subtract from the pallet count as well as
  // reducing pay (negative rate) — a rejected pallet lowers the productivity total.
  const quantity = lines.reduce((total, line) => {
    const palletType = findPalletType(palletTypes, line.palletTypeId);
    if (palletType?.category === "QC Deductions") return total - line.quantity;
    return total + line.quantity;
  }, 0);
  // Only owe the minimum-wage make-up when there's actual activity for the day
  // (pallets entered, or a phase counted/bypassed/photographed). An empty entry
  // means the person likely wasn't at work, so they earn nothing.
  const hasActivity =
    quantity > 0 ||
    (entry.phases ?? []).some(
      (phase) => (phase?.amount ?? 0) > 0 || Boolean(phase?.bypassed) || Boolean(phase?.photoDataUrl)
    );
  const minimumWageRequired = hasActivity
    ? regularHours * settings.minimumWage + overtimeHours * settings.minimumWage * settings.overtimeMultiplier
    : 0;
  const additionalOwed = Math.max(0, minimumWageRequired - pieceEarnings);
  const totalPay = pieceEarnings + additionalOwed;
  const hourlyEquivalent = paidHours > 0 ? pieceEarnings / paidHours : 0;

  return {
    pieceEarnings,
    quantity,
    regularHours,
    overtimeHours,
    weeklyOvertimeHours: 0,
    paidHours,
    workedHours,
    minimumWageRequired,
    additionalOwed,
    totalPay,
    hourlyEquivalent
  };
}

export function getWeekKey(dateValue: string) {
  const date = new Date(`${dateValue}T12:00:00`);
  const day = date.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(date);
  monday.setDate(date.getDate() + diffToMonday);
  return monday.toISOString().slice(0, 10);
}
