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

const legacyPalletTypeAliases: Record<string, string> = {
  "no-1": "stacker-grade-a-1",
  "no-2": "stacker-grade-b-2"
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
  // Pallet count excludes QC Deductions — those reduce pay (negative rate) but
  // are not pallets produced, so they should not inflate the productivity count.
  const quantity = lines.reduce((total, line) => {
    const palletType = findPalletType(palletTypes, line.palletTypeId);
    if (palletType?.category === "QC Deductions") return total;
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
