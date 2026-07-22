"use client";

import {
  BarChart3,
  Building2,
  CalendarDays,
  Camera,
  Check,
  CheckCircle2,
  Clock,
  Columns2,
  Database,
  Download,
  ExternalLink,
  Edit2,
  Eye,
  Factory,
  FileSpreadsheet,
  Filter,
  ImagePlus,
  LayoutGrid,
  Loader2,
  LogOut,
  MapPin,
  Maximize2,
  Moon,
  Plus,
  RotateCcw,
  RotateCw,
  Save,
  Search,
  ShieldCheck,
  Sun,
  Trash2,
  UserRound,
  X,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import {
  defaultPalletTypes,
  employees as defaultEmployees,
  locations as defaultLocations,
  palletCategories,
  payrollSettings,
  shifts as defaultShifts,
  timeOptions,
  yardPalletIds
} from "@/lib/data";
import { calculateEntry, currency, getWeekKey, wholeNumber } from "@/lib/payroll";
import { getAccessToken, roleLabels, roleViews, useAuth } from "@/lib/auth";
import { LanguageProvider, translate, useT, type Language } from "@/lib/i18n";
import type { ChangeLogEntry } from "@/lib/cloudChangeLog";
import AuthGate from "@/components/AuthGate";
import DropZone from "@/components/DropZone";
import CalendarField, { type DateSelection } from "@/components/CalendarField";
import type { BreakProfile, CountSheet, CountSheetStatus, DailyEntry, Employee, EntryPhase, Location, PalletCategory, PalletType, PayrollSettings, ProductionLine, Role, Shift } from "@/lib/types";

const entryStorageKey = "mgp-daily-entries-v2";
const countSheetStorageKey = "mgp-count-sheets-v1";
const palletStorageKey = "mgp-pallet-types-v2";
const employeeStorageKey = "mgp-employees-v2";
const locationStorageKey = "mgp-locations-v2";
const shiftStorageKey = "mgp-shifts-v2";
const payrollSettingsStorageKey = "mgp-payroll-settings-v1";
const today = new Date().toISOString().slice(0, 10);

// Photos shipped with the app keyed by employee id. Used to fill in a face for
// rosters loaded from the cloud/local storage that predate the photos, without
// overwriting a photo an admin has set themselves.
const seedPhotoById = new Map(
  defaultEmployees.filter((employee) => employee.photoDataUrl).map((employee) => [employee.id, employee.photoDataUrl!])
);
function withSeedPhotos(list: Employee[]): Employee[] {
  return list.map((employee) =>
    employee.photoDataUrl ? employee : { ...employee, photoDataUrl: seedPhotoById.get(employee.id) }
  );
}
// Maps an old/default pallet id to the slug of its code+description, so entries
// saved under a built-in default id (e.g. "stacker-grade-a-1") still resolve to
// the current pallet with that code+description after pallets were re-created
// with new (cloud) ids.
const defaultLabelSlugById = new Map(defaultPalletTypes.map((pallet) => [pallet.id, slugify(`${pallet.code} ${pallet.description}`)]));
const legacyPalletTypeAliases: Record<string, string> = {
  ...Object.fromEntries(defaultPalletTypes.map((pallet) => [pallet.id, defaultLabelSlugById.get(pallet.id)!])),
  "no-1": defaultLabelSlugById.get("stacker-grade-a-1") ?? "stacker-grade-a-1",
  "no-2": defaultLabelSlugById.get("stacker-grade-b-2") ?? "stacker-grade-b-2"
};

type View = "entry" | "count-sheets" | "production-grid" | "dashboard" | "live-yards" | "payroll" | "cloud" | "users" | "settings";
type AdminTab = "settings" | "pallets" | "employees" | "locations";

type EntryForm = Omit<DailyEntry, "id" | "createdAt">;

const emptyEmployee: Omit<Employee, "id"> = {
  name: "",
  locationId: "fontana",
  shift: "AM",
  active: true,
  role: "employee",
  notes: "",
  photoDataUrl: ""
};

const emptyPallet: Omit<PalletType, "id"> = {
  code: "",
  description: "",
  category: "Stacker",
  rate: 0,
  active: true,
  photoUrl: "",
  bilingualLabel: "",
  customerRateNote: "",
  locationRateNote: ""
};

function createLines(palletTypes: PalletType[]): ProductionLine[] {
  return palletTypes.map((pallet) => ({ palletTypeId: pallet.id, quantity: 0 }));
}

// Normalize a name for comparison (case/spacing/punctuation-insensitive).
function normName(name: string): string {
  return name.toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();
}

// Best-effort human name for an employee id when we can't find the record:
// "mgp-maria-reyes" -> "maria reyes". Used to match saved entries to repairers
// even when their roster id changed (e.g. entries saved under "maria-reyes"
// while the dropdown now uses "mgp-maria-reyes").
function slugToName(id: string): string {
  return id.replace(/^mgp-/, "").replace(/-/g, " ");
}

const PHASE_COUNT = 3;

// Time window each phase covers, shown alongside the phase number.
const PHASE_TIMES = ["6–9 AM", "9 AM–12:30 PM", "12:30–3:30 PM"];

function createPhases(): EntryPhase[] {
  return Array.from({ length: PHASE_COUNT }, () => ({ amount: 0, bypassed: false, lines: [] as ProductionLine[], notes: "" }));
}

// All photos on a phase, combining the legacy single photo with the array.
function phasePhotos(phase?: EntryPhase): string[] {
  const list = [...(phase?.photoDataUrls ?? [])];
  if (phase?.photoDataUrl && !list.includes(phase.photoDataUrl)) list.unshift(phase.photoDataUrl);
  return list.filter(Boolean);
}

// Make a stored photo path openable from a spreadsheet: absolute and data URLs
// are left as-is; a site-relative "/uploads/..." path gets the current origin
// so the link still works when opened outside the app.
function absolutePhotoUrl(url: string): string {
  if (!url || url.startsWith("http") || url.startsWith("data:")) return url;
  if (typeof window !== "undefined") return `${window.location.origin}${url}`;
  return url;
}

// Spreadsheet-friendly text for a photo: a clickable URL, or a short note for
// the legacy embedded (base64) photos that can't be linked.
function photoCellText(url: string): string {
  return url.startsWith("data:") ? "Embedded photo (view in app)" : absolutePhotoUrl(url);
}

// Always return exactly PHASE_COUNT phases, filling any that are missing. The
// legacy single photo is folded into the photo array so everything downstream
// only has to look at `photoDataUrls`.
function normalizePhases(phases?: EntryPhase[]): EntryPhase[] {
  const base = createPhases();
  (phases ?? []).slice(0, PHASE_COUNT).forEach((phase, index) => {
    base[index] = {
      amount: Number(phase?.amount) || 0,
      bypassed: Boolean(phase?.bypassed),
      photoDataUrls: phasePhotos(phase),
      notes: typeof phase?.notes === "string" ? phase.notes : "",
      lines: (phase?.lines ?? []).map((line) => ({
        palletTypeId: line.palletTypeId,
        quantity: Number(line.quantity) || 0,
        ...(Array.isArray(line.parts) && line.parts.length > 1 ? { parts: line.parts.map(Number) } : {})
      }))
    };
  });
  return base;
}

// Sum per-pallet quantities across a set of line arrays into one list.
function sumLines(lineSets: (ProductionLine[] | undefined)[]): ProductionLine[] {
  const map = new Map<string, number>();
  const partsByPallet = new Map<string, number[]>();
  lineSets.forEach((lines) =>
    (lines ?? []).forEach((line) => {
      map.set(line.palletTypeId, (map.get(line.palletTypeId) ?? 0) + Number(line.quantity || 0));
      if (Array.isArray(line.parts) && line.parts.length) {
        partsByPallet.set(line.palletTypeId, [...(partsByPallet.get(line.palletTypeId) ?? []), ...line.parts]);
      }
    })
  );
  return Array.from(map, ([palletTypeId, quantity]) => {
    const parts = partsByPallet.get(palletTypeId);
    return parts && parts.length > 1 ? { palletTypeId, quantity, parts } : { palletTypeId, quantity };
  });
}

// The day's full pallet list is the sum of every phase's lines.
function aggregatePhaseLines(phases: EntryPhase[]): ProductionLine[] {
  return sumLines(phases.map((phase) => phase.lines)).filter((line) => line.quantity !== 0);
}

// Net pallets for a phase: produced pallets minus QC-deduction lines (a quality
// reduction subtracts from the count rather than adding to it).
function phasePalletCount(phase: EntryPhase, palletTypes: PalletType[]): number {
  return (phase.lines ?? []).reduce((total, line) => {
    const palletType = findPalletType(palletTypes, line.palletTypeId);
    if (palletType?.category === "QC Deductions") return total - Number(line.quantity || 0);
    return total + Number(line.quantity || 0);
  }, 0);
}

// QC-deduction pallet count for a phase (shown separately as a negative).
function phaseQcCount(phase: EntryPhase, palletTypes: PalletType[]): number {
  return (phase.lines ?? []).reduce((total, line) => {
    const palletType = findPalletType(palletTypes, line.palletTypeId);
    if (palletType?.category !== "QC Deductions") return total;
    return total + Number(line.quantity || 0);
  }, 0);
}

// Merge one or more saved entries (same repairer/day) into a single set of
// phases: per-phase lines are summed, a phase is bypassed if any entry bypassed
// it, and the first photo wins. Legacy entries that stored a single aggregate
// `lines` (no per-phase breakdown) have those quantities seeded into Phase 1.
function combinePhases(entries: DailyEntry[], palletTypes: PalletType[]): EntryPhase[] {
  const base = createPhases();
  const phases = base.map((_basePhase, index) => {
    const lineSets: (ProductionLine[] | undefined)[] = [];
    let bypassed = false;
    const photoDataUrls: string[] = [];
    const noteParts: string[] = [];
    entries.forEach((entry) => {
      const phs = normalizePhases(entry.phases);
      const phase = phs[index];
      const entryHasPhaseLines = phs.some((p) => (p.lines ?? []).length > 0);
      if ((phase.lines ?? []).length > 0) lineSets.push(phase.lines);
      else if (index === 0 && !entryHasPhaseLines) lineSets.push(entry.lines);
      bypassed = bypassed || phase.bypassed;
      phasePhotos(phase).forEach((photo) => {
        if (!photoDataUrls.includes(photo)) photoDataUrls.push(photo);
      });
      const entryHasPhaseNotes = phs.some((p) => (p.notes ?? "").trim().length > 0);
      // Legacy entries stored one note at the day level; surface it on Phase 1
      // so older notes aren't lost now that notes live per phase.
      const note = ((phase.notes ?? "").trim() || (index === 0 && !entryHasPhaseNotes ? (entry.notes ?? "").trim() : "")).trim();
      if (note && !noteParts.includes(note)) noteParts.push(note);
    });
    const lines = sumLines(lineSets).filter((line) => line.quantity !== 0);
    return { amount: 0, bypassed, photoDataUrls, notes: noteParts.join("\n"), lines };
  });
  return phases.map((phase) => ({ ...phase, amount: phasePalletCount(phase, palletTypes) }));
}

// True once a phase has pallets entered, a photo, or has been bypassed.
function isPhaseDone(phase: EntryPhase): boolean {
  return phase.bypassed || phase.amount > 0 || (phase.lines ?? []).length > 0 || phasePhotos(phase).length > 0;
}

// The highest phase number that has been completed (0 = none yet).
function lastPhaseDone(phases: EntryPhase[]): number {
  let last = 0;
  phases.forEach((phase, index) => {
    if (isPhaseDone(phase)) last = index + 1;
  });
  return last;
}

// Toggle the Shift / Clock In / Clock Out / Hours / Break-Lunch row on the Daily
// Production Grid. Hidden for now per request, but kept here so it can be turned
// back on by flipping this to true (the form still tracks sensible defaults).
const SHOW_TIME_FIELDS = false;

// Per-yard pallet menus live in lib/data so the entry grid and live board share
// the same lists (imported as `yardPalletIds`).

// Returns the pallets a given yard makes, in the right order. Yards not listed
// in yardPalletIds (e.g. Fontana) get the full list unchanged. Custom pallets
// aren't part of any yard's fixed PDF list, so they're appended to every yard
// — add a Custom pallet once and it shows up everywhere for entry.
function palletsForYard(palletTypes: PalletType[], locationId: string): PalletType[] {
  const customPallets = palletTypes.filter((pallet) => pallet.active && pallet.category === "Custom");
  const allowed = yardPalletIds[locationId];
  let result: PalletType[];
  if (!allowed) {
    // Yards without a fixed list (e.g. Fontana) show every pallet in whatever
    // order they arrive from the cloud/defaults.
    result = [...palletTypes];
  } else {
    // Match by the same flexible lookup the rest of the app uses (id, code, or
    // slug) so it works even when the stored pallets carry legacy/cloud IDs.
    const matched = allowed
      .map((id) => findPalletType(palletTypes, id))
      .filter((pallet): pallet is PalletType => Boolean(pallet));
    // If nothing matched (unexpected ID scheme), fall back to showing everything
    // rather than an empty grid.
    const base = matched.length > 0 ? matched : palletTypes;
    const extras = customPallets.filter((custom) => !base.some((pallet) => pallet.id === custom.id));
    result = [...base, ...extras];
  }
  // Always list OUTSIDE GRADE B #2 before OUTSIDE GRADE A #1 in the grid,
  // whatever order they come back from the cloud in. Only reorders when A is
  // currently ahead of B, so it's a no-op where they're already in that order.
  const gradeA = findPalletType(result, "outside-grade-a-1");
  const gradeB = findPalletType(result, "outside-grade-b-2");
  if (gradeA && gradeB) {
    const indexA = result.indexOf(gradeA);
    const indexB = result.indexOf(gradeB);
    if (indexA > -1 && indexB > -1 && indexA < indexB) {
      [result[indexA], result[indexB]] = [result[indexB], result[indexA]];
    }
  }
  return result;
}

function isManager(employee?: Employee): boolean {
  return employee?.role === "supervisor";
}

function rosterRoleName(role?: string): string {
  return role === "supervisor" ? "Yard Manager" : "Repairer";
}

// Build a human-readable summary of what changed on a profile, for the change log.
function describeEmployeeChanges(before: Employee, patch: Partial<Employee>, locations: Location[]): string {
  const locName = (id?: string) => locations.find((location) => location.id === id)?.name ?? id ?? "";
  const parts: string[] = [];
  if (patch.name !== undefined && patch.name !== before.name) parts.push(`name "${before.name}" → "${patch.name}"`);
  if (patch.role !== undefined && patch.role !== before.role) parts.push(`job title ${rosterRoleName(before.role)} → ${rosterRoleName(patch.role)}`);
  if (patch.locationId !== undefined && patch.locationId !== before.locationId) parts.push(`yard ${locName(before.locationId)} → ${locName(patch.locationId)}`);
  if (patch.shift !== undefined && patch.shift !== before.shift) parts.push(`shift ${before.shift} → ${patch.shift}`);
  if (patch.active !== undefined && patch.active !== before.active) parts.push(patch.active ? "set Active" : "set Inactive");
  if (patch.photoDataUrl !== undefined && patch.photoDataUrl !== before.photoDataUrl) parts.push(patch.photoDataUrl ? "updated photo" : "removed photo");
  if (patch.notes !== undefined && patch.notes !== before.notes) parts.push("updated notes");
  return parts.join(", ");
}

// Preferred default yard managers, promoted automatically when a yard has none.
const defaultManagerIds = new Set(["lupita-reyes", "marco", "axel"]);

// Guarantee every active yard has at least one Yard Manager. Yards that already
// have a manager are left untouched, so manual assignments are preserved.
function ensureYardManagers(list: Employee[], locationList: Location[]): Employee[] {
  const result = [...list];
  let changed = false;

  for (const location of locationList) {
    if (!location.active) continue;
    const atYard = result.filter((employee) => employee.locationId === location.id && employee.active);
    if (atYard.length === 0 || atYard.some(isManager)) continue;

    const target = atYard.find((employee) => defaultManagerIds.has(employee.id)) ?? atYard[0];
    const index = result.findIndex((employee) => employee.id === target.id);
    result[index] = { ...result[index], role: "supervisor" };
    changed = true;
  }

  return changed ? result : list;
}

function createBlankForm(palletTypes: PalletType[], employeeList: Employee[]): EntryForm {
  const firstRepairer =
    employeeList.find((employee) => employee.active && !isManager(employee)) ??
    employeeList.find((employee) => employee.active) ??
    employeeList[0];
  const locationId = firstRepairer?.locationId ?? "fontana";
  const firstManager = employeeList.find(
    (employee) => employee.active && isManager(employee) && employee.locationId === locationId
  );

  return {
    date: today,
    employeeId: firstRepairer?.id ?? "",
    yardManagerId: firstManager?.id ?? "",
    locationId,
    shift: firstRepairer?.shift ?? "AM",
    lines: createLines(palletTypes.filter((pallet) => pallet.active)),
    phases: createPhases(),
    clockIn: "7:00 AM",
    clockOut: "3:30 PM",
    manualHours: 8.5,
    breakProfile: "standard",
    notes: ""
  };
}

function migrateEntry(raw: DailyEntry | (Omit<DailyEntry, "lines"> & { lines?: ProductionLine[]; palletTypeId?: string; quantity?: number })): DailyEntry {
  const legacy = raw as Omit<DailyEntry, "lines"> & { lines?: ProductionLine[]; palletTypeId?: string; quantity?: number };
  const sourceLines = Array.isArray(legacy.lines)
    ? legacy.lines
    : legacy.palletTypeId
      ? [{ palletTypeId: legacy.palletTypeId, quantity: Number(legacy.quantity ?? 0) }]
      : [];
  const mergedLines = new Map<string, number>();
  let migratedLegacyId = false;

  for (const line of sourceLines) {
    const resolvedId = legacyPalletTypeAliases[line.palletTypeId] ?? line.palletTypeId;
    migratedLegacyId ||= resolvedId !== line.palletTypeId;
    mergedLines.set(resolvedId, (mergedLines.get(resolvedId) ?? 0) + Number(line.quantity ?? 0));
  }

  return {
    ...legacy,
    lines: Array.from(mergedLines, ([palletTypeId, quantity]) => ({ palletTypeId, quantity })),
    phases: normalizePhases(legacy.phases),
    ...(migratedLegacyId ? { updatedAt: new Date().toISOString(), updatedBy: "Legacy pallet type migration" } : {})
  } as DailyEntry;
}

function sanitizeCountSheetsForStorage(countSheets: CountSheet[]) {
  return countSheets.map((sheet) => ({
    ...sheet,
    photos: sheet.photos.filter((photo) => !photo.url.startsWith("data:")).map((photo) => ({ ...photo }))
  }));
}

// Write to localStorage without ever throwing. Quota-exceeded (the cache got
// too big) would otherwise crash the app; the cloud is the source of truth, so
// dropping the cache on failure is safe.
function safeSetItem(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // ignore
    }
  }
}

// The localStorage copy of entries is only an offline cache — the cloud is the
// source of truth. Phase photos are large base64 strings that quickly blow past
// the ~5 MB localStorage quota (especially with several photos per phase), which
// would make setItem throw. Drop them from the cached copy; they reload from the
// cloud. (Lines/counts are kept so totals still work offline.)
function sanitizeEntriesForStorage(entries: DailyEntry[]): DailyEntry[] {
  return entries.map((entry) => ({
    ...entry,
    phases: entry.phases?.map((phase) => ({
      amount: phase.amount,
      bypassed: phase.bypassed,
      lines: phase.lines
    }))
  }));
}

function dataUrlToFile(dataUrl: string, fileName: string) {
  const [header, base64] = dataUrl.split(",");
  const mime = header.match(/data:(.*?);base64/)?.[1] ?? "image/jpeg";
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new File([bytes], fileName, { type: mime });
}

// iPhone photos are often HEIC/HEIF, which Chrome can't draw to a canvas or
// show in an <img>, so they'd save as broken images. Convert them to JPEG first
// (heic2any is loaded only when a HEIC actually shows up, to keep the bundle small).
async function toRenderableImage(file: File): Promise<File> {
  const isHeic = /hei[cf]/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
  if (!isHeic) return file;
  try {
    const heic2any = (await import("heic2any")).default;
    const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.85 });
    const blob = Array.isArray(converted) ? converted[0] : converted;
    const name = file.name.replace(/\.[^.]+$/, "") || "photo";
    return new File([blob], `${name}.jpg`, { type: "image/jpeg" });
  } catch {
    return file;
  }
}

// Parse a quantity entry that may be several numbers added together, e.g.
// "13 7 14" or "13+7+14" -> [13, 7, 14]. Used so a count sheet's stacked
// numbers can be typed and summed.
function parseQuantityParts(text: string): number[] {
  return text
    .split(/[\s+,]+/)
    .map((piece) => piece.trim())
    .filter(Boolean)
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0);
}

// ---- Custom on-screen numeric keypad for phones/tablets ----
// The native numeric keypad has no space bar, and space is how quantities are
// added together (e.g. "13 7 14" = 34). So on touch devices we suppress the
// native keyboard and show this keypad, which has digits AND a space key.
type KeypadTarget = {
  insert: (text: string) => void;
  backspace: () => void;
  done: () => void;
};
const MobileKeypadContext = createContext<{ register: (target: KeypadTarget | null) => void }>({
  register: () => undefined
});

// True on coarse-pointer devices (phones/tablets). Computed after mount so it
// never differs between server and first client render.
function useIsTouch() {
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    try {
      setTouch(window.matchMedia("(pointer: coarse)").matches);
    } catch {
      setTouch("ontouchstart" in window);
    }
  }, []);
  return touch;
}

// Keys use onMouseDown+preventDefault so tapping one never blurs (and thus never
// dismisses/commits) the field being edited; onClick does the actual work. This
// is the same trick native input toolbars use to stay open while you tap them.
function NumericKeypad({
  onKey,
  onBackspace,
  onDone
}: {
  onKey: (key: string) => void;
  onBackspace: () => void;
  onDone: () => void;
}) {
  const { t } = useT();
  const hold = (fn: () => void) => ({
    onMouseDown: (event: { preventDefault: () => void }) => event.preventDefault(),
    onClick: fn
  });
  const keyClass =
    "flex h-14 select-none items-center justify-center rounded-lg bg-white text-2xl font-black text-steel-900 shadow-sm active:bg-steel-200";
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-[70] border-t border-steel-300 bg-steel-100 px-1.5 pt-1.5"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 6px)" }}
    >
      <div className="mx-auto max-w-md">
        <div className="grid grid-cols-3 gap-1.5">
          {["7", "8", "9", "4", "5", "6", "1", "2", "3"].map((digit) => (
            <button key={digit} type="button" className={keyClass} {...hold(() => onKey(digit))}>
              {digit}
            </button>
          ))}
          <button type="button" className={keyClass + " col-span-2"} {...hold(() => onKey("0"))}>
            0
          </button>
          <button type="button" className={keyClass + " text-3xl"} aria-label="Backspace" {...hold(onBackspace)}>
            ⌫
          </button>
        </div>
        {/* + lives in its own colored bar, well away from the number keys, so
            tapping it can't be mistaken for the "1" above it. */}
        <button
          type="button"
          aria-label="Plus"
          className="mt-1.5 flex h-12 w-full select-none items-center justify-center gap-2 rounded-lg border-2 border-workshop-500 bg-workshop-100 text-2xl font-black text-workshop-700 active:bg-workshop-200"
          {...hold(() => onKey("+"))}
        >
          + <span className="text-sm font-black uppercase tracking-wide">{t("add")}</span>
        </button>
        <button
          type="button"
          className="mt-1.5 h-12 w-full rounded-lg bg-workshop-500 text-lg font-black text-white active:bg-workshop-700"
          {...hold(onDone)}
        >
          {t("Done")}
        </button>
      </div>
    </div>
  );
}

// Renders the keypad whenever a QuantityInput registers itself (on touch focus).
function MobileKeypadProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<KeypadTarget | null>(null);
  return (
    <MobileKeypadContext.Provider value={{ register: setTarget }}>
      {children}
      {target && (
        <NumericKeypad
          onKey={(key) => target.insert(key)}
          onBackspace={() => target.backspace()}
          onDone={() => target.done()}
        />
      )}
    </MobileKeypadContext.Provider>
  );
}

// A quantity box that accepts a single number or several numbers separated by
// spaces/plus signs. While focused it shows what you type; on blur it commits
// the sum (and the list of numbers, so a breakdown can be shown).
function QuantityInput({
  value,
  parts,
  onCommit,
  className,
  mode = "total",
  multiline = false
}: {
  value: number;
  parts?: number[];
  onCommit: (sum: number, parts: number[]) => void;
  className?: string;
  // "total" shows the summed number when blurred; "parts" shows the editable
  // list of numbers (e.g. "3 3 6 2 3 5") so the breakdown can be corrected.
  mode?: "total" | "parts";
  // When true, renders a textarea that stays one line for short content and
  // wraps to more lines (growing taller) only when it can't fit — so a long
  // equation is fully visible without horizontal scrolling, especially on phones.
  multiline?: boolean;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const keypad = useContext(MobileKeypadContext);
  const isTouch = useIsTouch();
  // Show the added numbers with + signs, e.g. "6 + 4 + 2 + 7".
  const expression = parts && parts.length > 1 ? parts.join(" + ") : value === 0 ? "" : String(value);
  const blurred = mode === "parts" ? expression : value === 0 ? "" : String(value);
  const display = editing !== null ? editing : blurred;
  // Grow the textarea's height to fit its content (wrapping when needed).
  useEffect(() => {
    const el = textareaRef.current;
    if (!multiline || !el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [display, multiline]);
  function commit() {
    if (editing === null) return;
    const nums = parseQuantityParts(editing);
    onCommit(
      nums.reduce((total, n) => total + n, 0),
      nums
    );
    setEditing(null);
  }
  function fieldEl() {
    return multiline ? textareaRef.current : inputRef.current;
  }
  function handleFocus() {
    setEditing(expression);
    if (!isTouch) return;
    // On touch, drive the field with our on-screen keypad (which has a space
    // key) instead of the native keyboard.
    keypad.register({
      insert: (text) => setEditing((prev) => (prev ?? "") + text),
      backspace: () => setEditing((prev) => (prev ?? "").slice(0, -1)),
      done: () => fieldEl()?.blur()
    });
    // Keep the field visible above the keypad.
    window.setTimeout(() => fieldEl()?.scrollIntoView({ block: "center", behavior: "smooth" }), 60);
  }
  function handleBlur() {
    keypad.register(null);
    commit();
  }
  const shared = {
    className,
    // On touch, suppress the native keyboard (inputMode "none") and use the
    // custom keypad; on desktop, allow normal typing (the space bar works there).
    inputMode: (isTouch ? "none" : "text") as "none" | "text",
    placeholder: "0",
    value: display,
    onFocus: handleFocus,
    onChange: (event: { target: { value: string } }) => setEditing(event.target.value)
  };
  if (multiline) {
    return (
      <textarea
        {...shared}
        ref={textareaRef}
        rows={1}
        onBlur={handleBlur}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            (event.target as HTMLTextAreaElement).blur();
          }
        }}
      />
    );
  }
  return (
    <input
      {...shared}
      ref={inputRef}
      type="text"
      onBlur={handleBlur}
      onKeyDown={(event) => {
        if (event.key === "Enter") (event.target as HTMLInputElement).blur();
      }}
    />
  );
}

// Trigger a browser download for a URL (data: or blob:).
function triggerDownload(href: string, fileName: string) {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Download a photo to the device, baking in any on-screen rotation so the saved
// file is oriented the way the viewer is showing it.
async function downloadPhoto(dataUrl: string, rotationDeg: number, fileName: string) {
  const rotation = (((rotationDeg % 360) + 360) % 360);
  try {
    let blob: Blob;
    if (rotation === 0) {
      blob = await (await fetch(dataUrl)).blob();
    } else {
      const img = await loadImageElement(dataUrl);
      const swap = rotation === 90 || rotation === 270;
      const canvas = document.createElement("canvas");
      canvas.width = swap ? img.naturalHeight : img.naturalWidth;
      canvas.height = swap ? img.naturalWidth : img.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("no canvas context");
      context.translate(canvas.width / 2, canvas.height / 2);
      context.rotate((rotation * Math.PI) / 180);
      context.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
      blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((result) => (result ? resolve(result) : reject(new Error("toBlob failed"))), "image/jpeg", 0.92)
      );
    }
    const url = URL.createObjectURL(blob);
    triggerDownload(url, fileName);
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch {
    // Fallback: download the original data URL directly.
    triggerDownload(dataUrl, fileName);
  }
}

// Open an image in a new browser tab. Chrome blocks navigating a new tab
// straight to a data: URL, so convert those to a blob: URL first; http(s)
// URLs open directly.
async function openImageInNewTab(src: string) {
  try {
    if (/^https?:/i.test(src)) {
      window.open(src, "_blank", "noopener");
      return;
    }
    const blob = await (await fetch(src)).blob();
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch {
    window.open(src, "_blank", "noopener");
  }
}

async function compressImage(input: File) {
  if (!input.type.startsWith("image/") && !/\.(heic|heif)$/i.test(input.name)) return input;
  const file = await toRenderableImage(input);

  const imageUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = imageUrl;
    });
    const maxSide = 1600;
    const ratio = Math.min(1, maxSide / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * ratio));
    const height = Math.max(1, Math.round(image.height * ratio));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(image, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.76));
    if (!blob) return file;
    const outputName = file.name.replace(/\.[^.]+$/, "") || "count-sheet";
    return new File([blob], `${outputName}.jpg`, { type: "image/jpeg" });
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

async function migrateLegacyCountSheets(countSheets: CountSheet[]) {
  const migrated: CountSheet[] = [];

  for (const sheet of countSheets) {
    const legacyPhotos = sheet.photos.filter((photo) => photo.url.startsWith("data:"));
    if (legacyPhotos.length === 0) continue;

    const formData = new FormData();
    formData.append("date", sheet.date);
    formData.append("locationId", sheet.locationId);
    formData.append("shift", sheet.shift);
    formData.append("uploadedBy", sheet.uploadedBy || "Counter");
    formData.append("notes", sheet.notes ?? "");
    legacyPhotos.forEach((photo, index) => {
      formData.append("photos", dataUrlToFile(photo.url, photo.fileName || `legacy-count-sheet-${index + 1}.jpg`));
    });

    try {
      const response = await fetch("/api/count-sheets", { method: "POST", body: formData });
      const result = (await response.json()) as { countSheet?: CountSheet };
      if (result.countSheet) migrated.push(result.countSheet);
    } catch {
      // If migration fails, the sanitized metadata still prevents quota crashes.
    }
  }

  return migrated;
}

function classNames(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(" ");
}

const allViews: View[] = ["entry", "count-sheets", "production-grid", "dashboard", "live-yards", "payroll", "cloud", "users", "settings"];

export default function Home() {
  const { configured, profile, signOut } = useAuth();
  const allowedViews = (configured && profile ? roleViews[profile.role] : allViews) as View[];
  const [view, setView] = useState<View>("entry");
  const [adminTab, setAdminTab] = useState<AdminTab>("settings");
  const [darkMode, setDarkMode] = useState(false);
  // UI language. Managers default to Spanish (most read Spanish) but anyone can
  // toggle; the choice is remembered.
  const [language, setLanguage] = useState<Language>("en");
  const [entries, setEntries] = useState<DailyEntry[]>([]);
  const [countSheets, setCountSheets] = useState<CountSheet[]>([]);
  const [palletTypes, setPalletTypes] = useState<PalletType[]>(defaultPalletTypes);
  const [employeeList, setEmployeeList] = useState<Employee[]>(defaultEmployees);
  const [locationList, setLocationList] = useState<Location[]>(defaultLocations);
  const [shiftList, setShiftList] = useState<Shift[]>(defaultShifts);
  const [settings, setSettings] = useState<PayrollSettings>(payrollSettings);
  const [form, setForm] = useState<EntryForm>(() => createBlankForm(defaultPalletTypes, defaultEmployees));
  // Id of the saved entry the form is currently editing (so Save updates it
  // instead of creating a duplicate). Null when starting a brand-new entry.
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState("Ready");
  const [adminStatus, setAdminStatus] = useState("Spreadsheet-style setup is ready.");
  const [selectedWeek, setSelectedWeek] = useState(getWeekKey(today));
  const [editingEntry, setEditingEntry] = useState<DailyEntry | null>(null);
  const [viewingEntry, setViewingEntry] = useState<DailyEntry | null>(null);
  const [profileEmployeeId, setProfileEmployeeId] = useState<string | null>(null);
  const [entriesLoaded, setEntriesLoaded] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [rosterLoaded, setRosterLoaded] = useState(false);
  const [toast, setToast] = useState("");
  const [changeLog, setChangeLog] = useState<ChangeLogEntry[]>([]);
  const toastTimer = useRef<number | undefined>(undefined);
  // Tracks whether the entry form has unsaved local edits. When it doesn't, the
  // view is safe to auto-refresh from incoming cloud data (so a manager/admin
  // who is just watching sees others' new photos/counts appear live); when it
  // does, we leave the form alone so we never clobber what someone is typing.
  const formDirtyRef = useRef(false);
  // Latest form selection, read inside the auto-refresh effect without making
  // it depend on (and re-run for) every keystroke.
  const formSelectionRef = useRef({ employeeId: "", date: "", locationId: "" });
  formSelectionRef.current = { employeeId: form.employeeId, date: form.date, locationId: form.locationId };

  function showToast(message: string) {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 2600);
  }

  // Keep the active tab valid for the signed-in role.
  useEffect(() => {
    if (!allowedViews.includes(view)) {
      setView(allowedViews[0]);
    }
  }, [allowedViews, view]);

  // One-time correction of the yard managers to the real people, applied once
  // per browser after the roster loads and saved to the cloud for everyone.
  useEffect(() => {
    if (!rosterLoaded) return;
    if (window.localStorage.getItem("mgp-manager-fix-v1")) return;
    window.localStorage.setItem("mgp-manager-fix-v1", "1");

    for (const name of ["Lupita Reyes", "Marco", "Axel"]) {
      const placeholder = employeeList.find((employee) => employee.name === name && employee.role === "supervisor");
      if (placeholder) updateEmployee(placeholder.id, { role: "employee" });
    }

    const correctManagers = [
      { name: "Adrian Baeza", locationId: "fontana" },
      { name: "Ernesto Fernandez", locationId: "citrus" },
      { name: "Luis Soriano", locationId: "mesa" }
    ];
    for (const manager of correctManagers) {
      const existing = employeeList.find((employee) => employee.name === manager.name);
      if (existing) {
        if (existing.role !== "supervisor") updateEmployee(existing.id, { role: "supervisor" });
      } else {
        createEmployee({ name: manager.name, locationId: manager.locationId, shift: "AM", active: true, role: "supervisor", notes: "", photoDataUrl: "" });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rosterLoaded]);

  // One-time rebuild of the full roster to match the official per-yard list
  // (from the managers' PDF). Matches existing people by name to keep their
  // photos/ids, moves the ones on the list to the right yard/role, and adds
  // anyone missing. It never deactivates anyone — repairers stay Active unless
  // an admin manually toggles them off. Saved to the cloud for everyone.
  useEffect(() => {
    if (!rosterLoaded) return;
    // Bump this key whenever the official per-yard roster (lib/data.ts) changes
    // so every device re-applies it once and overwrites stale saved assignments.
    if (window.localStorage.getItem("mgp-roster-pdf-v4")) return;
    window.localStorage.setItem("mgp-roster-pdf-v4", "1");

    const norm = (name: string) => name.toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();
    const targetByName = new Map(defaultEmployees.map((employee) => [norm(employee.name), employee]));
    const matched = new Set<string>();

    const reconciled: Employee[] = employeeList.map((employee) => {
      const target = targetByName.get(norm(employee.name));
      if (target) {
        matched.add(norm(employee.name));
        return { ...employee, locationId: target.locationId, role: target.role, active: true };
      }
      // Not on the official list — keep the person exactly as-is and Active.
      // Only an admin toggling them off makes a repairer inactive.
      return { ...employee, active: true };
    });

    for (const target of defaultEmployees) {
      if (matched.has(norm(target.name))) continue;
      reconciled.push({ ...target, id: `mgp-${norm(target.name).replace(/\s+/g, "-")}` });
    }

    const changed = reconciled.filter((employee, index) => {
      const before = employeeList[index];
      return !before || before.id !== employee.id || before.locationId !== employee.locationId || before.role !== employee.role || before.active !== employee.active;
    });

    setEmployeeList(reconciled);
    changed.forEach(saveEmployeeToCloud);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rosterLoaded]);

  useEffect(() => {
    const savedEntries = window.localStorage.getItem(entryStorageKey) ?? window.localStorage.getItem("mgp-daily-entries");
    let localEntries: DailyEntry[] = [];
    if (savedEntries) {
      localEntries = (JSON.parse(savedEntries) as DailyEntry[]).map(migrateEntry);
      safeSetItem(entryStorageKey, JSON.stringify(sanitizeEntriesForStorage(localEntries)));
      setEntries(localEntries);
    }

    // Load the cloud first, then merge with cloud winning. The local copy is a
    // cache that has been stripped of photos (to fit the storage quota), so it
    // must NEVER overwrite a cloud entry — doing so erased photos. Only push up
    // local entries the cloud doesn't have yet (e.g. created while offline).
    fetch("/api/entries")
      .then((response) => response.json())
      .then((result: { entries: DailyEntry[] }) => {
        const cloudEntries = result.entries.map(migrateEntry);
        const cloudIds = new Set(cloudEntries.map((entry) => entry.id));
        const merged = new Map<string, DailyEntry>();
        // Local first, cloud second, so the cloud's photo-bearing copy wins.
        [...localEntries, ...cloudEntries].forEach((entry) => merged.set(entry.id, entry));
        setEntries(Array.from(merged.values()).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)));
        localEntries
          .filter((entry) => !cloudIds.has(entry.id))
          .forEach((entry) => {
            fetch("/api/entries?syncSheets=false", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(entry)
            }).catch(() => undefined);
          });
      })
      .finally(() => setEntriesLoaded(true));

    const savedCountSheets = window.localStorage.getItem(countSheetStorageKey);
    if (savedCountSheets) {
      const parsedCountSheets = JSON.parse(savedCountSheets) as CountSheet[];
      setCountSheets(sanitizeCountSheetsForStorage(parsedCountSheets));
      migrateLegacyCountSheets(parsedCountSheets).then((migrated) => {
        if (migrated.length > 0) {
          setCountSheets((current) => [...migrated, ...current.filter((sheet) => !sheet.photos.some((photo) => photo.url.startsWith("data:")))]);
        }
      });
    }

    const savedPallets = window.localStorage.getItem(palletStorageKey);
    if (savedPallets) {
      setPalletTypes(JSON.parse(savedPallets));
    } else {
      safeSetItem(palletStorageKey, JSON.stringify(defaultPalletTypes));
    }

    const savedLocations = window.localStorage.getItem(locationStorageKey);
    const effectiveLocations: Location[] = savedLocations ? JSON.parse(savedLocations) : defaultLocations;
    if (savedLocations) {
      setLocationList(effectiveLocations);
    }

    const savedEmployees = window.localStorage.getItem(employeeStorageKey);
    const localRoster = ensureYardManagers(
      savedEmployees ? (JSON.parse(savedEmployees) as Employee[]) : defaultEmployees,
      effectiveLocations
    );
    setEmployeeList(withSeedPhotos(localRoster));

    // Pull the shared roster from the cloud; if the cloud is empty, seed it from
    // this device so existing repairers move up.
    fetch("/api/employees")
      .then((response) => response.json())
      .then(async (result: { employees: Employee[]; storage?: string }) => {
        if (result.storage !== "cloud") return;
        if (result.employees.length > 0) {
          setEmployeeList(withSeedPhotos(ensureYardManagers(result.employees, effectiveLocations)));
        } else {
          await Promise.all(
            localRoster.map((employee) =>
              fetch("/api/employees", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(employee)
              }).catch(() => undefined)
            )
          );
        }
      })
      .catch(() => undefined)
      .finally(() => setRosterLoaded(true));

    fetch("/api/change-log")
      .then((response) => response.json())
      .then((result: { entries: ChangeLogEntry[] }) => setChangeLog(result.entries ?? []))
      .catch(() => undefined);

    const savedShifts = window.localStorage.getItem(shiftStorageKey);
    if (savedShifts) {
      setShiftList(JSON.parse(savedShifts));
    }

    const savedPayrollSettings = window.localStorage.getItem(payrollSettingsStorageKey);
    if (savedPayrollSettings) {
      const parsedSettings = { ...payrollSettings, ...JSON.parse(savedPayrollSettings) } as PayrollSettings;
      setSettings({
        ...parsedSettings,
        minimumWage: parsedSettings.minimumWage === 16.5 ? payrollSettings.minimumWage : parsedSettings.minimumWage
      });
    }

    fetch("/api/settings")
      .then((response) => response.json())
      .then((result: { settings: PayrollSettings }) => setSettings({ ...payrollSettings, ...result.settings }))
      .finally(() => setSettingsLoaded(true));

    fetch("/api/pallet-types")
      .then((response) => response.json())
      .then((result: { configured: boolean; storage?: string; palletTypes: PalletType[] }) => {
        if (result.palletTypes.length > 0) {
          setPalletTypes(result.palletTypes);
          setAdminStatus(result.configured ? "Loaded pallet types from Supabase." : "Loaded pallet types from local server storage.");
        }
      })
      .catch(() => setAdminStatus("Using local storage until Supabase is configured."));

    fetch("/api/count-sheets")
      .then((response) => response.json())
      .then((result: { configured: boolean; storage?: "local"; countSheets: CountSheet[] }) => {
        if (result.configured || result.storage === "local") {
          setCountSheets(result.countSheets);
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!entriesLoaded) return;
    const loadSharedEntries = () => {
      fetch("/api/entries", { cache: "no-store" })
        .then((response) => response.json())
        .then((result: { entries: DailyEntry[] }) => {
          setEntries(result.entries.map(migrateEntry).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)));
        })
        .catch(() => undefined);
    };
    // Poll a tiny fingerprint every 10s and only pull the full (photo-heavy)
    // entries when something actually changed. This makes another manager's or
    // admin's saved photos show up here within ~10s without re-downloading every
    // photo on a timer. A slow full refresh + focus refresh are safety nets.
    let lastFingerprint: string | null = null;
    const checkForChanges = async () => {
      try {
        const response = await fetch("/api/entries/ping", { cache: "no-store" });
        const { fingerprint } = (await response.json()) as { fingerprint?: string };
        const next = fingerprint ?? "";
        if (lastFingerprint === null) {
          lastFingerprint = next; // seed on first check; initial load already ran
          return;
        }
        if (next !== lastFingerprint) {
          lastFingerprint = next;
          loadSharedEntries();
        }
      } catch {
        // ignore transient network errors
      }
    };
    const pingTimer = window.setInterval(checkForChanges, 10_000);
    const fullTimer = window.setInterval(loadSharedEntries, 180_000);
    window.addEventListener("focus", loadSharedEntries);
    return () => {
      window.clearInterval(pingTimer);
      window.clearInterval(fullTimer);
      window.removeEventListener("focus", loadSharedEntries);
    };
  }, [entriesLoaded]);

  useEffect(() => {
    if (!entriesLoaded) return;
    try {
      window.localStorage.setItem(entryStorageKey, JSON.stringify(sanitizeEntriesForStorage(entries)));
    } catch {
      // Over quota or storage blocked — the cloud is the source of truth, so
      // just drop the stale cache rather than letting the write throw.
      try {
        window.localStorage.removeItem(entryStorageKey);
      } catch {
        // ignore
      }
    }
  }, [entries, entriesLoaded]);

  useEffect(() => {
    try {
      window.localStorage.setItem(countSheetStorageKey, JSON.stringify(sanitizeCountSheetsForStorage(countSheets)));
    } catch {
      window.localStorage.removeItem(countSheetStorageKey);
    }
  }, [countSheets]);

  useEffect(() => {
    safeSetItem(palletStorageKey, JSON.stringify(palletTypes));
  }, [palletTypes]);

  useEffect(() => {
    safeSetItem(employeeStorageKey, JSON.stringify(employeeList));
  }, [employeeList]);

  useEffect(() => {
    safeSetItem(locationStorageKey, JSON.stringify(locationList));
  }, [locationList]);

  useEffect(() => {
    safeSetItem(shiftStorageKey, JSON.stringify(shiftList));
  }, [shiftList]);

  useEffect(() => {
    safeSetItem(payrollSettingsStorageKey, JSON.stringify(settings));
    if (settingsLoaded) {
      fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings)
      }).catch(() => undefined);
    }
  }, [settings, settingsLoaded]);

  const activePalletTypes = useMemo(() => palletTypes.filter((pallet) => pallet.active), [palletTypes]);
  const activeEmployees = useMemo(() => employeeList.filter((employee) => employee.active), [employeeList]);
  const selectedEmployee = employeeList.find((employee) => employee.id === form.employeeId) ?? activeEmployees[0] ?? employeeList[0];
  const currentCalculation = calculateEntry({ ...form, id: "preview", createdAt: new Date().toISOString() }, palletTypes, settings);

  // A Manager only ever sees the yards an admin allowed them. Admins, and
  // Managers with no yards specified, see everything (empty list = all yards).
  const allowedYards = useMemo(
    () => (configured && profile?.role === "supervisor" ? profile.allowedYards : []),
    [configured, profile]
  );
  const scopedLocationList = useMemo(
    () => (allowedYards.length ? locationList.filter((location) => allowedYards.includes(location.id)) : locationList),
    [allowedYards, locationList]
  );
  const scopedEntries = useMemo(
    () => (allowedYards.length ? entries.filter((entry) => allowedYards.includes(entry.locationId)) : entries),
    [allowedYards, entries]
  );
  const scopedCountSheets = useMemo(
    () => (allowedYards.length ? countSheets.filter((sheet) => allowedYards.includes(sheet.locationId)) : countSheets),
    [allowedYards, countSheets]
  );

  // Keep a Manager's entry form on one of their allowed yards.
  useEffect(() => {
    if (allowedYards.length && !allowedYards.includes(form.locationId)) {
      handleYardChange(allowedYards[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowedYards]);

  // Keep the selected repairer valid. Roster reconciliation can change employee
  // ids (e.g. "jose-ramirez" -> "mgp-jose-ramirez"), leaving form.employeeId
  // pointing at nothing — which made the card, the Repairer dropdown, and the
  // station edits disagree. If the current id isn't a real repairer in this
  // yard, snap to the first one so everything points at the same person.
  useEffect(() => {
    if (!rosterLoaded) return;
    const repairers = activeEmployees.filter((employee) => employee.locationId === form.locationId && !isManager(employee));
    if (repairers.length > 0 && !repairers.some((employee) => employee.id === form.employeeId)) {
      handleEmployeeChange(repairers[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEmployees, form.locationId, rosterLoaded]);

  useEffect(() => {
    setForm((current) => {
      const currentLines = new Map(current.lines.map((line) => [line.palletTypeId, line.quantity]));
      const nextLines = activePalletTypes.map((pallet) => ({
        palletTypeId: pallet.id,
        quantity: currentLines.get(pallet.id) ?? 0
      }));

      return { ...current, lines: nextLines };
    });
  }, [activePalletTypes]);

  // Clean up saved entries so the grid and live board show the truth:
  //  1) Merge duplicate entries for the same repairer + day (the old save bug
  //     created a new record every time, which double-counted on the board and
  //     made the grid load just one of them — often an empty one showing 0).
  //  2) Put each entry on the repairer's current yard, so moving someone between
  //     yards carries their production with them.
  // Sums pallets, merges phase check-ins, keeps the newest record's id, deletes
  // the extras, and saves the result. Idempotent: once everything is one entry
  // per repairer/day on the right yard, there's nothing left to do.
  useEffect(() => {
    if (!entriesLoaded) return;
    // Canonical id + yard for each repairer name, taken from the live roster so
    // entries snap onto whatever id the dropdown currently uses (active records
    // win over deactivated duplicates).
    const idByName = new Map<string, string>();
    const yardByName = new Map<string, string>();
    [...employeeList].sort((a, b) => Number(b.active) - Number(a.active)).forEach((employee) => {
      const key = normName(employee.name);
      if (!idByName.has(key)) {
        idByName.set(key, employee.id);
        yardByName.set(key, employee.locationId);
      }
    });

    const groups = new Map<string, DailyEntry[]>();
    entries.forEach((entry) => {
      const key = `${normName(nameOfEmployeeId(entry.employeeId))}|${entry.date}`;
      const group = groups.get(key);
      if (group) group.push(entry);
      else groups.set(key, [entry]);
    });

    const merged: DailyEntry[] = [];
    const deleteIds: string[] = [];
    groups.forEach((group, key) => {
      const nameKey = key.split("|")[0];
      const primary = [...group].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))[0];
      const targetId = idByName.get(nameKey) ?? primary.employeeId;
      const targetYard = yardByName.get(nameKey) ?? primary.locationId;
      const phases = combinePhases(group, palletTypes);
      const result: DailyEntry = {
        ...primary,
        employeeId: targetId,
        locationId: targetYard,
        lines: aggregatePhaseLines(phases),
        phases
      };
      const changed = group.length > 1 || primary.employeeId !== targetId || primary.locationId !== targetYard;
      if (changed) {
        merged.push(result);
        group.filter((entry) => entry.id !== primary.id).forEach((entry) => deleteIds.push(entry.id));
      }
    });

    if (merged.length === 0 && deleteIds.length === 0) return;
    const deleteSet = new Set(deleteIds);
    const mergedById = new Map(merged.map((entry) => [entry.id, entry]));
    setEntries((current) => current.filter((entry) => !deleteSet.has(entry.id)).map((entry) => mergedById.get(entry.id) ?? entry));
    merged.forEach((entry) => {
      fetch("/api/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry)
      }).catch(() => undefined);
    });
    deleteIds.forEach((id) => {
      fetch(`/api/entries/${id}`, { method: "DELETE" }).catch(() => undefined);
    });
  }, [entriesLoaded, employeeList, entries]);

  // Once saved entries are loaded, hydrate the initially-selected repairer's form
  // so the grid opens showing their real numbers (matching the live board)
  // rather than a blank form.
  useEffect(() => {
    if (!entriesLoaded) return;
    const data = entryFormData(form.employeeId, form.date, form.locationId);
    setEditingEntryId(data.existingId);
    setForm((current) => ({ ...current, lines: data.lines, phases: data.phases }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entriesLoaded]);

  // When fresh entries arrive (e.g. another manager/admin just saved photos),
  // refresh the on-screen form for the person being viewed — but only if there
  // are no unsaved local edits, so we never overwrite what someone is typing.
  // This is what makes a colleague's photos appear here live without clicking.
  useEffect(() => {
    if (!entriesLoaded || formDirtyRef.current) return;
    const { employeeId, date, locationId } = formSelectionRef.current;
    if (!employeeId) return;
    const data = entryFormData(employeeId, date, locationId);
    setEditingEntryId(data.existingId);
    setForm((current) => ({ ...current, lines: data.lines, phases: data.phases }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, entriesLoaded]);


  function updateForm<T extends keyof EntryForm>(key: T, value: EntryForm[T]) {
    formDirtyRef.current = true;
    setForm((current) => ({ ...current, [key]: value }));
  }

  // Pick the starting language. Order of preference: the choice saved to the
  // account (follows the user across devices), then a device-local choice, then
  // the role default — managers start in Spanish, admins/everyone else English.
  useEffect(() => {
    if (profile?.preferredLanguage === "en" || profile?.preferredLanguage === "es") {
      setLanguage(profile.preferredLanguage);
      return;
    }
    const stored = window.localStorage.getItem("mgp-language");
    if (stored === "en" || stored === "es") {
      setLanguage(stored);
    } else if (configured && profile?.role === "supervisor") {
      setLanguage("es");
    } else {
      setLanguage("en");
    }
  }, [configured, profile?.role, profile?.preferredLanguage]);

  function changeLanguage(next: Language) {
    setLanguage(next);
    safeSetItem("mgp-language", next);
    // Persist to the account so the choice follows the user to any device.
    try {
      const token = getAccessToken();
      if (token) {
        void fetch("/api/auth/language", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ language: next })
        }).catch(() => undefined);
      }
    } catch {
      // Network/token issue — the device-local choice above still applies.
    }
  }

  const t = (text: string, vars?: Record<string, string | number>) => translate(language, text, vars);

  // Human name for an employee id, tolerant of id changes: checks the live
  // roster, then the built-in roster, then falls back to de-slugging the id.
  function nameOfEmployeeId(id: string): string {
    return (
      employeeList.find((employee) => employee.id === id)?.name ??
      defaultEmployees.find((employee) => employee.id === id)?.name ??
      slugToName(id)
    );
  }

  // Pulls a repairer's already-saved entry (for the given day + yard) back into
  // the form so the grid shows their real numbers instead of a blank form, and
  // remembers its id so Save updates that entry rather than creating a duplicate.
  function entryFormData(employeeId: string, date: string, locationId: string) {
    // Sum ALL of this repairer's entries for the day (across yards) so the grid
    // shows their true total even if the old save bug left duplicates or their
    // entries are split across yards. Match by NAME, not raw id, so entries
    // saved under an older id (e.g. "maria-reyes") still load for the current
    // dropdown id (e.g. "mgp-maria-reyes"). Saving consolidates into one record.
    const targetName = normName(nameOfEmployeeId(employeeId));
    const matching = entries.filter(
      (entry) => normName(nameOfEmployeeId(entry.employeeId)) === targetName && entry.date === date
    );
    const phases = combinePhases(matching, palletTypes);
    const primary =
      matching.find((entry) => entry.locationId === locationId) ??
      [...matching].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))[0];
    return {
      existingId: primary?.id ?? null,
      lines: aggregatePhaseLines(phases),
      phases
    };
  }

  function handleEmployeeChange(employeeId: string) {
    const employee = employeeList.find((item) => item.id === employeeId);
    const data = entryFormData(employeeId, form.date, form.locationId);
    formDirtyRef.current = false;
    setEditingEntryId(data.existingId);
    setForm((current) => ({
      ...current,
      employeeId,
      shift: employee?.shift ?? current.shift,
      lines: data.lines,
      phases: data.phases
    }));
  }

  function handleDateChange(date: string) {
    const data = entryFormData(form.employeeId, date, form.locationId);
    formDirtyRef.current = false;
    setEditingEntryId(data.existingId);
    setForm((current) => ({ ...current, date, lines: data.lines, phases: data.phases }));
  }

  function handleYardChange(locationId: string) {
    const repairers = activeEmployees.filter((employee) => employee.locationId === locationId && !isManager(employee));
    const managers = activeEmployees.filter((employee) => employee.locationId === locationId && isManager(employee));
    const employeeId = repairers.some((employee) => employee.id === form.employeeId)
      ? form.employeeId
      : repairers[0]?.id ?? "";
    const yardManagerId = managers.some((employee) => employee.id === form.yardManagerId)
      ? form.yardManagerId
      : managers[0]?.id ?? "";
    const selectedRepairer = repairers.find((employee) => employee.id === employeeId);
    const data = entryFormData(employeeId, form.date, locationId);
    formDirtyRef.current = false;
    setEditingEntryId(data.existingId);
    setForm((current) => ({
      ...current,
      locationId,
      employeeId,
      yardManagerId,
      shift: selectedRepairer?.shift ?? current.shift,
      lines: data.lines,
      phases: data.phases
    }));
  }

  // Quantities are entered per phase. Updating a phase's line also refreshes
  // that phase's non-QC count (`amount`) and the day's aggregate `lines`, which
  // is what pay and the live board read.
  function updatePhaseLineQuantity(phaseIndex: number, palletTypeId: string, quantity: number, parts?: number[]) {
    formDirtyRef.current = true;
    setForm((current) => {
      const qty = Math.max(0, Number(quantity) || 0);
      // Keep the breakdown only when it's genuinely several numbers added.
      const keepParts = parts && parts.length > 1 ? parts : undefined;
      const phases = normalizePhases(current.phases).map((phase, index) => {
        if (index !== phaseIndex) return phase;
        const without = (phase.lines ?? []).filter((line) => line.palletTypeId !== palletTypeId);
        const lines = qty === 0 ? without : [...without, { palletTypeId, quantity: qty, ...(keepParts ? { parts: keepParts } : {}) }];
        return { ...phase, lines };
      });
      const withAmounts = phases.map((phase) => ({ ...phase, amount: phasePalletCount(phase, palletTypes) }));
      return { ...current, phases: withAmounts, lines: aggregatePhaseLines(withAmounts) };
    });
  }

  // Notes are kept per repairer per phase: this updates only the given phase's
  // note on the current form, so it never leaks to other phases or repairers.
  function updatePhaseNotes(phaseIndex: number, value: string) {
    formDirtyRef.current = true;
    setForm((current) => {
      const phases = normalizePhases(current.phases).map((phase, index) => (index === phaseIndex ? { ...phase, notes: value } : phase));
      return { ...current, phases };
    });
  }

  async function saveEntry() {
    // Reuse the id of the entry being edited so this updates that day's record
    // (the cloud upserts by id) instead of piling up duplicate entries that the
    // live board would double-count.
    const entryId = editingEntryId ?? `entry-${Date.now()}`;
    const cleanPhases = normalizePhases(form.phases).map((phase) => ({
      ...phase,
      amount: phasePalletCount(phase, palletTypes),
      lines: (phase.lines ?? []).filter((line) => line.quantity !== 0)
    }));
    // The day-level note is just a summary of the per-phase notes (deduped),
    // kept so the entries list and board still show something at a glance.
    const combinedNotes = Array.from(
      new Set(cleanPhases.map((phase) => (phase.notes ?? "").trim()).filter(Boolean))
    ).join("\n");
    const cleanEntry: DailyEntry = {
      ...form,
      id: entryId,
      notes: combinedNotes,
      manualHours: Number(form.manualHours),
      phases: cleanPhases,
      lines: aggregatePhaseLines(cleanPhases),
      createdAt: new Date().toISOString(),
      submittedBy: profile?.fullName || profile?.username || undefined,
      submittedById: profile?.id
    };

    setEntries((current) => [cleanEntry, ...current.filter((entry) => entry.id !== entryId)]);
    // Saved — the form now matches the cloud, so it's safe to auto-refresh again.
    formDirtyRef.current = false;
    // Keep the saved numbers on screen (and keep editing this same entry) so the
    // grid totals reflect what was just saved and match the live board.
    setEditingEntryId(entryId);
    setSaveStatus("Saving…");
    showToast(t("Daily grid saved"));

    try {
      const response = await fetch("/api/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cleanEntry)
      });
      const result = await response.json();
      if (result.storage === "cloud" && result.ok === false) {
        setSaveStatus(`Cloud error: ${result.error ?? "unknown"}`);
      } else if (result.storage === "cloud") {
        setSaveStatus("Saved to the cloud");
      } else {
        setSaveStatus(result.sheets?.configured ? "Saved to Sheets" : "Saved locally; cloud not configured");
      }
    } catch {
      setSaveStatus("Saved locally; sync pending");
    }
  }

  async function updateSavedEntry(updatedEntry: DailyEntry) {
    const stampedEntry = {
      ...updatedEntry,
      updatedAt: new Date().toISOString(),
      updatedBy: "Admin"
    };
    setEntries((current) => current.map((entry) => (entry.id === stampedEntry.id ? stampedEntry : entry)));
    setSaveStatus(`Updated entry for ${updatedEntry.date}`);
    try {
      await fetch(`/api/entries/${stampedEntry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(stampedEntry)
      });
    } catch {
      setSaveStatus(`Updated locally; shared sync pending for ${updatedEntry.date}`);
    }
  }

  // Re-point every entry line that references an orphaned/unknown pallet id
  // (e.g. a legacy "custom:…") to a real pallet type, so the production gets a
  // name and rate and starts counting in payroll everywhere. Rewrites the
  // affected entries in place via the normal save path.
  async function remapPalletInEntries(fromId: string, toId: string): Promise<number> {
    const touches = (lines?: ProductionLine[]) => (lines ?? []).some((line) => line.palletTypeId === fromId);
    const remapLines = (lines?: ProductionLine[]): ProductionLine[] => {
      const result: ProductionLine[] = [];
      const indexByType = new Map<string, number>();
      for (const line of lines ?? []) {
        const id = line.palletTypeId === fromId ? toId : line.palletTypeId;
        if (indexByType.has(id)) {
          result[indexByType.get(id)!].quantity += Number(line.quantity || 0);
        } else {
          indexByType.set(id, result.length);
          result.push({ ...line, palletTypeId: id });
        }
      }
      return result;
    };
    const affected = entries.filter((entry) => touches(entry.lines) || (entry.phases ?? []).some((phase) => touches(phase.lines)));
    for (const entry of affected) {
      await updateSavedEntry({
        ...entry,
        lines: remapLines(entry.lines),
        phases: entry.phases?.map((phase) => ({ ...phase, lines: remapLines(phase.lines) }))
      });
    }
    return affected.length;
  }

  async function deleteSavedEntry(id: string) {
    const entry = entries.find((item) => item.id === id);
    const employee = employeeList.find((item) => item.id === entry?.employeeId);
    if (!entry || !window.confirm(`Delete entry for ${employee?.name ?? "repairer"} on ${entry.date}?`)) {
      return;
    }

    setEntries((current) => current.filter((item) => item.id !== id));
    setSaveStatus("Entry deleted.");
    try {
      await fetch(`/api/entries/${id}`, { method: "DELETE" });
    } catch {
      setSaveStatus("Entry deleted locally; shared sync pending.");
    }
  }

  async function createCountSheet(input: {
    date: string;
    locationId: string;
    shift: Shift;
    uploadedBy: string;
    notes: string;
    files: File[];
  }) {
    try {
      const compressedFiles = await Promise.all(input.files.map(compressImage));
      const formData = new FormData();
      formData.append("date", input.date);
      formData.append("locationId", input.locationId);
      formData.append("shift", input.shift);
      formData.append("uploadedBy", input.uploadedBy || "Counter");
      formData.append("notes", input.notes);
      compressedFiles.forEach((file) => formData.append("photos", file));
      const response = await fetch("/api/count-sheets", { method: "POST", body: formData });
      const result = (await response.json()) as { configured: boolean; storage?: "local"; countSheet?: CountSheet; error?: string };
      if (!response.ok || !result.countSheet) {
        throw new Error(result.error ?? "Count sheet upload failed.");
      }
      setCountSheets((current) => [result.countSheet!, ...current]);
      if (result.configured) {
        return "Count sheet saved to Supabase Storage.";
      }
      return "Count sheet saved to local uploads until Supabase Storage is configured.";
    } catch (error) {
      return error instanceof Error ? error.message : "Count sheet upload failed.";
    }
  }

  async function updateCountSheet(id: string, patch: Partial<CountSheet>) {
    const stampedPatch = { ...patch, updatedAt: new Date().toISOString(), updatedBy: "Admin" };
    setCountSheets((current) => current.map((sheet) => (sheet.id === id ? { ...sheet, ...stampedPatch } : sheet)));

    try {
      await fetch(`/api/count-sheets/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: patch.status,
          notes: patch.notes,
          comments: patch.comments,
          updatedBy: "Admin"
        })
      });
    } catch {
      // Local state remains the source of truth until Supabase is available.
    }
  }

  async function deleteCountSheet(id: string) {
    const sheet = countSheets.find((item) => item.id === id);
    if (!sheet || !window.confirm(`Delete count sheet for ${sheet.date} ${sheet.shift}?`)) {
      return;
    }

    setCountSheets((current) => current.filter((item) => item.id !== id));
    try {
      await fetch(`/api/count-sheets/${id}`, { method: "DELETE" });
    } catch {
      // Local delete is still persisted in localStorage.
    }
  }

  async function createPalletType(palletType: Omit<PalletType, "id">) {
    const localPalletType = { ...palletType, id: `pallet-${Date.now()}` };
    setPalletTypes((current) => [...current, localPalletType]);
    setAdminStatus("Pallet type saved locally.");

    try {
      const response = await fetch("/api/pallet-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(palletType)
      });
      const result = (await response.json()) as { configured: boolean; palletType?: PalletType };
      if (result.palletType) {
        setPalletTypes((current) => current.map((item) => (item.id === localPalletType.id ? result.palletType! : item)));
        setAdminStatus(result.configured ? "Pallet type saved to Supabase." : "Pallet type saved to local server storage.");
      }
    } catch {
      setAdminStatus("Pallet type saved locally; sync pending.");
    }
  }

  async function updatePalletType(id: string, patch: Partial<PalletType>) {
    setPalletTypes((current) => current.map((pallet) => (pallet.id === id ? { ...pallet, ...patch } : pallet)));
    setAdminStatus("Pallet type updated locally.");

    try {
      const response = await fetch(`/api/pallet-types/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch)
      });
      const result = (await response.json()) as { configured: boolean };
      setAdminStatus(result.configured ? "Pallet type updated in Supabase." : "Pallet type updated locally; Supabase not configured.");
    } catch {
      setAdminStatus("Pallet type updated locally; sync pending.");
    }
  }

  async function deletePalletType(id: string) {
    setPalletTypes((current) => current.filter((item) => item.id !== id));
    setAdminStatus("Pallet type deleted locally.");

    try {
      await fetch(`/api/pallet-types/${id}`, { method: "DELETE" });
    } catch {
      setAdminStatus("Pallet type deleted locally; sync pending.");
    }
  }

  function logChange(action: string, targetName: string, summary: string) {
    logChangeTo("employee", action, targetName, summary);
  }

  // Generic cloud audit-log writer. Optimistically prepends to the local log so
  // the Cloud tab shows it immediately, then persists to the shared cloud table.
  function logChangeTo(targetType: string, action: string, targetName: string, summary: string) {
    if (!summary) return;
    const entry: ChangeLogEntry = {
      actor: profile?.fullName || profile?.username || "admin",
      action,
      targetType,
      targetName,
      summary
    };
    setChangeLog((current) => [{ ...entry, at: new Date().toISOString() }, ...current]);
    fetch("/api/change-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry)
    }).catch(() => undefined);
  }

  function saveEmployeeToCloud(employee: Employee) {
    fetch("/api/employees", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(employee)
    }).catch(() => undefined);
  }

  function createEmployee(employee: Omit<Employee, "id">) {
    const newEmployee: Employee = { ...employee, id: `employee-${Date.now()}` };
    setEmployeeList((current) => [...current, newEmployee]);
    setAdminStatus("Repairer saved to the cloud.");
    saveEmployeeToCloud(newEmployee);
    logChange("created", newEmployee.name, `Added ${rosterRoleName(newEmployee.role)} ${newEmployee.name}`);
  }

  function updateEmployee(id: string, patch: Partial<Employee>) {
    const before = employeeList.find((employee) => employee.id === id);
    setEmployeeList((current) => current.map((employee) => (employee.id === id ? { ...employee, ...patch } : employee)));
    setAdminStatus("Repairer updated in the cloud.");
    if (before) {
      const updated = { ...before, ...patch };
      saveEmployeeToCloud(updated);
      logChange("updated", updated.name, describeEmployeeChanges(before, patch, locationList));
    }
  }

  function deleteEmployee(id: string) {
    const before = employeeList.find((employee) => employee.id === id);
    setEmployeeList((current) => current.filter((item) => item.id !== id));
    fetch(`/api/employees/${id}`, { method: "DELETE" }).catch(() => undefined);
    if (before) logChange("deleted", before.name, `Removed ${before.name}`);
  }

  function exportCsv(filteredEntries = entries) {
    const header = [
      "Date",
      "Week",
      "Employee",
      "Location",
      "Shift",
      "Pallet Category",
      "Pallet Description",
      "Rate",
      "Quantity",
      "Line Earned",
      "Gross Piece Pay",
      "Make-up Pay",
      "Compliance Minimum Wage",
      "Daily OT Hours",
      "Total Pay",
      "Photos"
    ];
    const rows = filteredEntries.flatMap((entry) => {
      const employee = employeeList.find((item) => item.id === entry.employeeId)?.name ?? entry.employeeId;
      const location = locationList.find((item) => item.id === entry.locationId)?.name ?? entry.locationId;
      const calc = calculateEntry(entry, palletTypes, settings);
      // The day's count-sheet photo links (matched by date/yard/shift), shown on
      // every line of the entry so each date carries its count-sheet photos.
      const photos = getLinkedCountSheets(countSheets, entry)
        .flatMap((sheet) => sheet.photos.map((photo) => photoCellText(photo.url)))
        .join(" ; ");

      return entry.lines.map((line) => {
        const pallet = findPalletType(palletTypes, line.palletTypeId);
        return [
          entry.date,
          getWeekKey(entry.date),
          employee,
          location,
          entry.shift,
          pallet?.category ?? "",
          `${pallet?.code ?? ""} ${pallet?.description ?? ""}`.trim(),
          pallet?.rate ?? 0,
          line.quantity,
          ((pallet?.rate ?? 0) * line.quantity).toFixed(2),
          calc.pieceEarnings.toFixed(2),
          calc.additionalOwed.toFixed(2),
          settings.minimumWage.toFixed(2),
          calc.overtimeHours.toFixed(2),
          calc.totalPay.toFixed(2),
          photos
        ];
      });
    });

    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `mgp-payroll-${today}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  // Build a multi-sheet .xlsx from the (filtered) entries so accounting gets the
  // information cleanly separated: a summary, payroll per employee, the raw
  // per-pallet-line detail, and rollups by pallet type, yard, and day. Uses the
  // same numbers as calculateEntry/buildReport, so it matches the on-screen totals.
  async function exportExcel(filteredEntries = entries) {
    const ExcelJSModule = await import("exceljs");
    // The browser build may expose the API on `default` or on the module itself.
    const ExcelJS = ((ExcelJSModule as unknown as { default?: typeof ExcelJSModule }).default ?? ExcelJSModule) as typeof ExcelJSModule;
    const report = buildReport(filteredEntries, palletTypes, employeeList, locationList, settings);
    const money = (value: number) => Number((Number(value) || 0).toFixed(2));
    const locName = (id: string) => locationList.find((location) => location.id === id)?.name ?? id;
    const sortedDates = filteredEntries.map((entry) => entry.date).sort();
    const rangeLabel = sortedDates.length ? `${sortedDates[0]} to ${sortedDates[sortedDates.length - 1]}` : "All dates";

    const workbook = new ExcelJS.Workbook();
    // A plain data sheet: header row (bold), then rows, with column widths and an
    // optional autofilter — matches the previous export's look.
    const addSheet = (name: string, header: (string | number)[], rows: (string | number)[][], widths: number[], filter = false) => {
      const sheet = workbook.addWorksheet(name);
      sheet.columns = widths.map((width) => ({ width }));
      sheet.addRow(header);
      sheet.getRow(1).font = { bold: true };
      rows.forEach((row) => sheet.addRow(row));
      if (filter && rows.length > 0) {
        sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length + 1, column: header.length } };
      }
      return sheet;
    };

    const summary = workbook.addWorksheet("Summary");
    summary.columns = [{ width: 24 }, { width: 42 }];
    [
      ["MGP Pallet Repair — Production & Payroll Export"],
      ["Date range", rangeLabel],
      ["Generated", new Date().toLocaleString()],
      ["Entries", filteredEntries.length],
      [],
      ["Total Pallets", report.summary.quantity],
      ["Employees", report.byEmployee.length],
      ["Piece Pay", money(report.summary.piecePay)],
      ["Make-up Pay", money(report.summary.makeup)],
      ["Total Payroll", money(report.summary.totalPay)]
    ].forEach((row) => summary.addRow(row));
    summary.getRow(1).font = { bold: true, size: 13 };

    addSheet(
      "Payroll by Employee",
      ["Employee", "Yard", "Shift", "Total Pallets", "Paid Hours", "Piece Pay", "Make-up Pay", "Daily OT Hrs", "Weekly OT Hrs", "Total Pay"],
      report.byEmployee.map((row) => [
        row.employee.name, locName(row.employee.locationId), row.employee.shift ?? "",
        row.quantity, money(row.hours), money(row.piecePay), money(row.makeup),
        money(row.dailyOvertime), money(row.weeklyOvertime), money(row.totalPay)
      ]),
      [20, 12, 7, 13, 11, 11, 12, 12, 13, 11],
      true
    );

    addSheet(
      "Production Detail",
      ["Date", "Week", "Employee", "Yard", "Shift", "Pallet Category", "Pallet Name", "Rate", "Quantity", "Line Earned"],
      filteredEntries.flatMap((entry) => {
        const employeeName = employeeList.find((employee) => employee.id === entry.employeeId)?.name ?? entry.employeeId;
        const yard = locName(entry.locationId);
        return entry.lines.map((line) => {
          const pallet = findPalletType(palletTypes, line.palletTypeId);
          const rate = Number(pallet?.rate ?? 0);
          return [entry.date, getWeekKey(entry.date), employeeName, yard, entry.shift, pallet?.category ?? "", `${pallet?.code ?? ""} ${pallet?.description ?? ""}`.trim(), rate, line.quantity, money(rate * line.quantity)];
        });
      }),
      [12, 12, 20, 12, 7, 15, 34, 7, 10, 12],
      true
    );

    addSheet(
      "By Pallet Type",
      ["Pallet Category", "Pallet Name", "Total Quantity", "Total Piece Pay"],
      report.byPallet.map((row) => [row.category, row.label, row.quantity, money(row.piecePay)]),
      [15, 34, 14, 15],
      true
    );

    const yardTotals = new Map<string, { employees: number; quantity: number; piecePay: number; totalPay: number }>();
    for (const row of report.byEmployee) {
      const current = yardTotals.get(row.employee.locationId) ?? { employees: 0, quantity: 0, piecePay: 0, totalPay: 0 };
      current.employees += 1;
      current.quantity += row.quantity;
      current.piecePay += row.piecePay;
      current.totalPay += row.totalPay;
      yardTotals.set(row.employee.locationId, current);
    }
    addSheet(
      "Yard Totals",
      ["Yard", "Employees", "Total Pallets", "Piece Pay", "Total Pay"],
      Array.from(yardTotals.entries())
        .map(([id, value]) => [locName(id), value.employees, value.quantity, money(value.piecePay), money(value.totalPay)] as (string | number)[])
        .sort((a, b) => Number(b[2]) - Number(a[2])),
      [14, 11, 13, 11, 11]
    );

    // The count sheets backing the exported days, matched to the entries by
    // date/yard/shift and de-duplicated (several repairers share one day's
    // sheet). This is the source for the per-day photo count and the Photos tab.
    const sheetById = new Map<string, CountSheet>();
    for (const entry of filteredEntries) {
      for (const sheet of getLinkedCountSheets(countSheets, entry)) sheetById.set(sheet.id, sheet);
    }
    const exportSheets = [...sheetById.values()].sort(
      (a, b) => a.date.localeCompare(b.date) || (a.uploadTime ?? "").localeCompare(b.uploadTime ?? "")
    );

    // Count-sheet photos per day, so the daily rollup shows how many photos
    // back up each day's numbers.
    const photosByDate = new Map<string, number>();
    for (const sheet of exportSheets) {
      photosByDate.set(sheet.date, (photosByDate.get(sheet.date) ?? 0) + sheet.photos.length);
    }
    addSheet(
      "Daily Totals",
      ["Date", "Pallets", "Piece Pay", "Total Pay", "Photos"],
      report.byDay.map((row) => [row.label, row.quantity, money(row.piecePay), money(row.totalPay), photosByDate.get(row.label) ?? 0]),
      [12, 10, 11, 11, 8]
    );

    // Photos tab: one row per count-sheet photo, listed by date, with the actual
    // image embedded in the Photo column. No separate link column — the photo is
    // the content. Only if an image can't be loaded does that one cell fall back
    // to a clickable link, so a photo is never lost.
    const photoSheet = workbook.addWorksheet("Photos");
    photoSheet.columns = [{ width: 12 }, { width: 12 }, { width: 7 }, { width: 18 }, { width: 8 }, { width: 30 }];
    photoSheet.addRow(["Date", "Yard", "Shift", "Uploaded By", "Photo #", "Photo"]);
    photoSheet.getRow(1).font = { bold: true };

    const loadPhoto = async (url: string): Promise<{ dataUri: string; extension: "jpeg" | "png" | "gif" } | null> => {
      try {
        if (url.startsWith("data:")) {
          const kind = /^data:image\/(png|gif)/i.exec(url)?.[1]?.toLowerCase();
          return { dataUri: url, extension: kind === "png" ? "png" : kind === "gif" ? "gif" : "jpeg" };
        }
        const response = await fetch(absolutePhotoUrl(url));
        if (!response.ok) return null;
        const blob = await response.blob();
        const dataUri = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        const type = (blob.type || "").toLowerCase();
        return { dataUri, extension: type.includes("png") ? "png" : type.includes("gif") ? "gif" : "jpeg" };
      } catch {
        return null;
      }
    };

    let photoRowIndex = 1;
    for (const sheet of exportSheets) {
      const yard = locName(sheet.locationId);
      for (let index = 0; index < sheet.photos.length; index += 1) {
        const url = sheet.photos[index].url;
        photoRowIndex += 1;
        const row = photoSheet.addRow([sheet.date, yard, sheet.shift, sheet.uploadedBy ?? "", index + 1, ""]);
        row.height = 120;
        const image = await loadPhoto(url);
        if (image) {
          const imageId = workbook.addImage({ base64: image.dataUri, extension: image.extension });
          // Column F (0-based index 5); anchor into this row with a small inset.
          photoSheet.addImage(imageId, {
            tl: { col: 5.05, row: photoRowIndex - 1 + 0.05 },
            ext: { width: 190, height: 135 }
          });
        } else {
          // Couldn't load the image — fall back to a clickable link in the same
          // Photo cell so it's still reachable.
          const linkTarget = url.startsWith("data:") ? "" : absolutePhotoUrl(url);
          const photoCell = photoSheet.getCell(photoRowIndex, 6);
          photoCell.value = linkTarget ? { text: "Open photo", hyperlink: linkTarget } : "Embedded photo (view in app)";
          if (linkTarget) photoCell.font = { color: { argb: "FF1258A8" }, underline: true };
        }
      }
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    triggerDownload(url, `mgp-production-payroll-${today}.xlsx`);
    URL.revokeObjectURL(url);
  }

  // Current repairer + station, shown as a second row inside the app header
  // while on the Entry screen, so managers always see who they're entering for.
  const entryStationEmployee = employeeList.find((employee) => employee.id === form.employeeId) ?? selectedEmployee;
  const entryStationLabel = entryStationEmployee?.station
    ? `${t(entryStationEmployee.station === "sorter" ? "Sorter" : "Repair Line")}${entryStationEmployee.stationSpot ? ` · ${t("Spot {n}", { n: entryStationEmployee.stationSpot })}` : ""}`
    : t("No station set");

  return (
    <AuthGate>
    <LanguageProvider value={{ language, setLanguage: changeLanguage, t }}>
    <MobileKeypadProvider>
    <main className={classNames("min-h-screen pb-24 transition-colors", darkMode ? "bg-steel-900/[0.95] text-white" : "bg-steel-50/[0.88] text-steel-900")}>
      <header className={classNames("sticky top-0 z-20 border-b backdrop-blur", darkMode ? "border-white/10 bg-steel-900/[0.92]" : "border-steel-100 bg-white/[0.92]")}>
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <img src="/logo.svg" alt="Manufacturing Green Products" className="h-12 w-12 shrink-0 rounded-full sm:h-14 sm:w-14" />
            <div className="min-w-0">
              <p className="truncate text-xs font-bold uppercase tracking-wide text-workshop-700">MGP</p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h1 className="truncate text-lg font-black sm:text-2xl">Pallet Repair Tracking</h1>
                <a
                  href="/live-board"
                  target="_blank"
                  rel="noreferrer"
                  className="hidden shrink-0 rounded-full bg-workshop-100 px-3 py-1 text-xs font-black text-workshop-700 hover:bg-workshop-500 hover:text-white sm:inline-block"
                >
                  {t("Live Pallet Tracker →")}
                </a>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {configured && profile && (
              <div className={classNames("flex overflow-hidden rounded border text-xs font-black", darkMode ? "border-white/20" : "border-steel-200")}>
                {(["en", "es"] as Language[]).map((code) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => changeLanguage(code)}
                    className={classNames(
                      "px-2.5 py-2",
                      language === code ? "bg-workshop-500 text-white" : darkMode ? "bg-white/10 text-white" : "bg-white text-steel-500"
                    )}
                  >
                    {code.toUpperCase()}
                  </button>
                ))}
              </div>
            )}
            {configured && profile && (
              <div className="hidden text-right sm:block">
                <p className="text-sm font-black leading-tight">{profile.fullName || profile.username}</p>
                <p className="text-xs font-bold uppercase tracking-wide text-workshop-700">{roleLabels[profile.role]}</p>
              </div>
            )}
            <button
              type="button"
              aria-label="Toggle dark mode"
              className={classNames("touch-target flex w-12 items-center justify-center rounded border", darkMode ? "border-white/20 bg-white/10" : "border-steel-100 bg-white")}
              onClick={() => setDarkMode((value) => !value)}
            >
              {darkMode ? <Sun size={20} /> : <Moon size={20} />}
            </button>
            {configured && profile && (
              <button
                type="button"
                aria-label="Sign out"
                title="Sign out"
                className={classNames("touch-target flex w-12 items-center justify-center rounded border", darkMode ? "border-white/20 bg-white/10" : "border-steel-100 bg-white")}
                onClick={() => signOut()}
              >
                <LogOut size={20} />
              </button>
            )}
          </div>
        </div>
        {/* Second header row (Entry screen only): who + station you're entering
            for. It lives INSIDE the sticky header, so it can never overlap it. */}
        {view === "entry" && configured && profile && (
          <div className={classNames("mx-auto flex max-w-7xl items-center gap-2.5 border-t px-4 py-2", darkMode ? "border-white/10" : "border-steel-100")}>
            <Avatar employee={entryStationEmployee} size="sm" />
            <div className="min-w-0">
              <p className="truncate text-sm font-black leading-tight">{entryStationEmployee?.name ?? t("Repairer")}</p>
              <p className={classNames("truncate text-xs font-bold leading-tight", entryStationEmployee?.station ? "text-workshop-700" : darkMode ? "text-steel-300" : "text-steel-400")}>{entryStationLabel}</p>
            </div>
          </div>
        )}
      </header>

      <div className="mx-auto grid max-w-7xl gap-4 px-4 py-4">
        <nav className={classNames("no-scrollbar flex gap-2 overflow-x-auto rounded border p-2", darkMode ? "border-white/10 bg-white/[0.08]" : "border-steel-100 bg-white/90")}>
          {allowedViews.includes("entry") && <NavButton icon={<Plus size={19} />} label={t("Entry")} active={view === "entry"} onClick={() => setView("entry")} />}
          {allowedViews.includes("count-sheets") && <NavButton icon={<Camera size={19} />} label={t("Count Sheets")} active={view === "count-sheets"} onClick={() => setView("count-sheets")} />}
          {allowedViews.includes("production-grid") && <NavButton icon={<FileSpreadsheet size={19} />} label={t("Production Grid")} active={view === "production-grid"} onClick={() => setView("production-grid")} />}
          {allowedViews.includes("dashboard") && <NavButton icon={<BarChart3 size={19} />} label={t("Dashboard")} active={view === "dashboard"} onClick={() => setView("dashboard")} />}
          {allowedViews.includes("live-yards") && <NavButton icon={<LayoutGrid size={19} />} label={t("Live Yards")} active={view === "live-yards"} onClick={() => setView("live-yards")} />}
          {allowedViews.includes("payroll") && <NavButton icon={<FileSpreadsheet size={19} />} label={t("Payroll")} active={view === "payroll"} onClick={() => setView("payroll")} />}
          {allowedViews.includes("cloud") && <NavButton icon={<Database size={19} />} label="Cloud" active={view === "cloud"} onClick={() => setView("cloud")} />}
          {allowedViews.includes("users") && <NavButton icon={<UserRound size={19} />} label="Users" active={view === "users"} onClick={() => setView("users")} />}
          {allowedViews.includes("settings") && <NavButton icon={<ShieldCheck size={19} />} label="Admin" active={view === "settings"} onClick={() => setView("settings")} />}
        </nav>

        <section className={classNames("rounded border p-4 shadow-panel", darkMode ? "border-white/10 bg-steel-800/[0.94]" : "border-steel-100 bg-white/95")}>
          {view === "entry" && (
            <ProductionEntry
              darkMode={darkMode}
              form={form}
              saveStatus={saveStatus}
              selectedEmployee={selectedEmployee}
              employees={activeEmployees}
              entries={scopedEntries}
              locations={scopedLocationList}
              shifts={shiftList}
              palletTypes={activePalletTypes}
              calculation={currentCalculation}
              onEmployeeChange={handleEmployeeChange}
              onYardChange={handleYardChange}
              onDateChange={handleDateChange}
              onFormChange={updateForm}
              onQuantityChange={updatePhaseLineQuantity}
              onPhaseNotesChange={updatePhaseNotes}
              onStationChange={(employeeId, patch) => updateEmployee(employeeId, patch)}
              onSave={saveEntry}
              hideYardManager={configured && profile?.role === "supervisor"}
              hidePricing={configured && profile?.role === "supervisor"}
            />
          )}
          {view === "count-sheets" && (
            <CountSheetsModule
              countSheets={scopedCountSheets}
              entries={scopedEntries}
              locations={scopedLocationList}
              shifts={shiftList}
              onCreate={createCountSheet}
              onUpdate={updateCountSheet}
              onDelete={deleteCountSheet}
            />
          )}
          {view === "production-grid" && (
            <ProductionGrid
              entries={scopedEntries}
              countSheets={scopedCountSheets}
              employees={employeeList}
              locations={scopedLocationList}
              palletTypes={palletTypes}
              settings={settings}
              selectedWeek={selectedWeek}
              onWeekChange={setSelectedWeek}
              onSelectEmployee={setProfileEmployeeId}
              onEditEntry={setEditingEntry}
              onViewEntry={setViewingEntry}
              onDeleteEntry={deleteSavedEntry}
              exportCsv={exportCsv}
              exportExcel={exportExcel}
            />
          )}
          {view === "dashboard" && <Dashboard settings={settings} darkMode={darkMode} countSheets={scopedCountSheets} entries={scopedEntries} locations={scopedLocationList} shifts={shiftList} palletTypes={palletTypes} employees={employeeList} onSelectEmployee={setProfileEmployeeId} />}
          {view === "live-yards" && <LiveYards settings={settings} darkMode={darkMode} entries={scopedEntries} locations={scopedLocationList} palletTypes={palletTypes} employees={employeeList} onSelectEmployee={setProfileEmployeeId} />}
          {view === "payroll" && (
            <Payroll
              entries={entries}
              countSheets={countSheets}
              employees={employeeList}
              locations={locationList}
              shifts={shiftList}
              palletTypes={palletTypes}
              settings={settings}
              exportCsv={exportCsv}
              exportExcel={exportExcel}
              darkMode={darkMode}
              onEditEntry={setEditingEntry}
              onViewEntry={setViewingEntry}
              onDeleteEntry={deleteSavedEntry}
              onSelectEmployee={setProfileEmployeeId}
            />
          )}
          {view === "cloud" && (
            <CloudBrowser
              entries={entries}
              employees={employeeList}
              locations={locationList}
              palletTypes={palletTypes}
              settings={settings}
              changeLog={changeLog}
              onViewEntry={setViewingEntry}
            />
          )}
          {view === "users" && <UsersAdmin onLogChange={(targetName, summary) => logChangeTo("user", "updated permissions", targetName, summary)} />}
          {view === "settings" && (
            <Settings
              darkMode={darkMode}
              status={adminStatus}
              activeTab={adminTab}
              setActiveTab={setAdminTab}
              palletTypes={palletTypes}
              entries={entries}
              employees={employeeList}
              locations={locationList}
              shifts={shiftList}
              settings={settings}
              onCreatePallet={createPalletType}
              onUpdatePallet={updatePalletType}
              onDeletePallet={deletePalletType}
              onRemapPallet={remapPalletInEntries}
              onCreateEmployee={createEmployee}
              onUpdateEmployee={updateEmployee}
              onDeleteEmployee={deleteEmployee}
              onLocationsChange={setLocationList}
              onShiftsChange={setShiftList}
              onSettingsChange={setSettings}
            />
          )}
        </section>
      </div>

      {(editingEntry || viewingEntry) && (
        <EntryEditorModal
          mode={editingEntry ? "edit" : "view"}
          entry={(editingEntry ?? viewingEntry)!}
          employees={employeeList}
          locations={locationList}
          shifts={shiftList}
          palletTypes={palletTypes}
          settings={settings}
          onClose={() => {
            setEditingEntry(null);
            setViewingEntry(null);
          }}
          onSave={(entry) => {
            updateSavedEntry(entry);
            setEditingEntry(null);
          }}
        />
      )}

      {profileEmployeeId && (
        <RepairerProfileModal
          employee={employeeList.find((employee) => employee.id === profileEmployeeId)}
          entries={entries}
          employees={employeeList}
          locations={locationList}
          palletTypes={palletTypes}
          settings={settings}
          selectedWeek={selectedWeek}
          onClose={() => setProfileEmployeeId(null)}
          onEditEntry={setEditingEntry}
          onViewEntry={setViewingEntry}
        />
      )}

      <style jsx global>{`
        .field {
          width: 100%;
          border-radius: 4px;
          border: 1px solid #d7dee3;
          background: white;
          color: #18222c;
          padding: 0.75rem;
          font-weight: 700;
          outline: none;
        }

        .field:focus {
          border-color: #2d7d71;
          box-shadow: 0 0 0 3px rgba(45, 125, 113, 0.18);
        }
      `}</style>

      {toast && (
        <div className="pointer-events-none fixed bottom-7 left-1/2 z-50 -translate-x-1/2 [animation:toast-in_0.4s_cubic-bezier(0.22,1,0.36,1)]">
          <div className="flex items-center gap-2 rounded-full bg-workshop-500 px-6 py-3.5 text-base font-black text-white shadow-panel">
            <CheckCircle2 size={22} className="[animation:toast-check_0.5s_ease-out]" />
            {toast}
          </div>
        </div>
      )}
    </main>
    </MobileKeypadProvider>
    </LanguageProvider>
    </AuthGate>
  );
}

// Phase 1/2/3 tracker for the selected repairer: a task bar of the three
// phases, a side panel of their amounts, and inputs (amount, photo, bypass) for
// the phase you pick. Shown to admins and managers on the entry page.
function PhaseTracker({
  repairerName,
  phases,
  onChange,
  crew,
  activeId,
  onSelectRepairer,
  selected,
  onSelect,
  phaseCounts,
  phaseQcCounts
}: {
  repairerName: string;
  phases: EntryPhase[];
  onChange: (next: EntryPhase[]) => void;
  // Every repairer in the yard and their phase check-ins for the day. `phases`
  // is null when that person has not been entered yet (shows "No check-in").
  crew: { id: string; name: string; photoDataUrl?: string; phases: EntryPhase[] | null }[];
  activeId: string;
  onSelectRepairer: (id: string) => void;
  // Which phase the grid is editing (lifted to the parent so the grid and this
  // tracker stay in sync).
  selected: number;
  onSelect: (index: number) => void;
  // Pallets produced per phase (QC excluded) and QC-deduction counts per phase.
  phaseCounts: number[];
  phaseQcCounts: number[];
}) {
  const { t } = useT();
  const lastDone = lastPhaseDone(phases);
  // Full-screen view of a phase photo so count sheets can be read.
  const [zoomPhoto, setZoomPhoto] = useState<string | null>(null);
  // Rotation (degrees) applied to the zoomed photo so a sideways count sheet can
  // be turned upright; resets each time a new photo is opened.
  const [zoomRotation, setZoomRotation] = useState(0);
  // Magnification of the zoomed photo (1 = fit to screen) so small print on a
  // count sheet can be enlarged, and the pixel offset used to pan/scroll around
  // the enlarged image. Both reset each time a new photo is opened.
  const [zoomScale, setZoomScale] = useState(1);
  const [zoomOffset, setZoomOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  // Where the current drag started, so pointer moves translate into an offset.
  const panStart = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null);
  // Side-by-side mode: instead of covering the whole screen, the photo docks to
  // the right half so accounting can read the count sheet and type the numbers
  // into the form at the same time. The choice sticks for the session so the
  // next photo opens the way they left it.
  const [splitView, setSplitView] = useState(false);
  // Photos that fail to render (e.g. an old HEIC saved before conversion) so we
  // can show a clear "re-upload" placeholder instead of a broken-image icon.
  const [brokenPhotos, setBrokenPhotos] = useState<string[]>([]);

  // While the photo is docked side-by-side, shrink the page so the form reflows
  // into the visible left half instead of hiding behind the panel. Only on wide
  // screens — on a phone the panel takes the full width like the full-screen view.
  useEffect(() => {
    if (!zoomPhoto || !splitView) return;
    const apply = () => {
      document.body.style.paddingRight = window.innerWidth >= 640 ? "46vw" : "";
    };
    apply();
    window.addEventListener("resize", apply);
    return () => {
      window.removeEventListener("resize", apply);
      document.body.style.paddingRight = "";
    };
  }, [zoomPhoto, splitView]);

  useEffect(() => {
    setZoomRotation(0);
    setZoomScale(1);
    setZoomOffset({ x: 0, y: 0 });
  }, [zoomPhoto]);

  // Step the magnification within [1, 5]; dropping back to 1 re-centers the image.
  function adjustZoom(delta: number) {
    setZoomScale((value) => {
      const next = Math.min(5, Math.max(1, Number((value + delta).toFixed(2))));
      if (next === 1) setZoomOffset({ x: 0, y: 0 });
      return next;
    });
  }

  // Close the full-screen viewer with the Escape key.
  useEffect(() => {
    if (!zoomPhoto) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setZoomPhoto(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [zoomPhoto]);

  function updatePhase(index: number, patch: Partial<EntryPhase>) {
    onChange(phases.map((phase, current) => (current === index ? { ...phase, ...patch } : phase)));
  }

  function readAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(file);
    });
  }

  // Add one or more photos to a phase, keeping any already there. Photos are
  // uploaded to storage and only their (small) URLs are kept on the phase, so
  // the entry JSON stays small enough for the cloud to save. If the upload
  // fails, fall back to embedding the image so the photo is never lost on screen.
  async function handlePhasePhoto(index: number, files: File[]) {
    if (!files.length) return;
    const compressed = await Promise.all(files.map((file) => compressImage(file)));
    let urls: string[] = [];
    try {
      const body = new FormData();
      compressed.forEach((file) => body.append("photos", file));
      body.append("scope", activeId || "phase");
      const response = await fetch("/api/entry-photos", { method: "POST", body });
      const result = (await response.json()) as { urls?: string[] };
      if (Array.isArray(result.urls) && result.urls.length === compressed.length) {
        urls = result.urls;
      }
    } catch {
      // Network/storage failure — handled by the fallback below.
    }
    if (urls.length !== compressed.length) {
      urls = await Promise.all(compressed.map((file) => readAsDataUrl(file)));
    }
    const existing = phasePhotos(phases[index]);
    updatePhase(index, { photoDataUrl: undefined, photoDataUrls: [...existing, ...urls] });
  }

  function removePhasePhoto(index: number, photo: string) {
    updatePhase(index, { photoDataUrl: undefined, photoDataUrls: phasePhotos(phases[index]).filter((item) => item !== photo) });
  }

  const active = phases[selected];
  const activePhotos = phasePhotos(active);

  return (
    <div className="grid gap-3 rounded border border-steel-100 bg-white p-3 text-steel-900 md:grid-cols-[1fr_300px]">
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-lg font-black">{repairerName}</p>
            <p className="text-xs font-bold text-steel-500">
              {lastDone > 0 ? t("Last entered: Phase {n}", { n: lastDone }) : t("No phases entered yet")}
            </p>
          </div>
          {/* Dropdown under the name to pick which phase to input. */}
          <select
            className="field max-w-[180px]"
            value={selected}
            onChange={(event) => onSelect(Number(event.target.value))}
          >
            {phases.map((_phase, index) => (
              <option key={index} value={index}>
                {t("Phase {n}", { n: index + 1 })} · {PHASE_TIMES[index]}
              </option>
            ))}
          </select>
        </div>

        {/* Task bar: tap a phase to open it. Each tab shows the pallets made in
            that phase; phases 2 and 3 also show how that compares to the phase
            before (green if same/more, red if fewer) as a productivity gauge. */}
        <div className="flex items-stretch gap-2">
          {phases.map((phase, index) => {
            const done = isPhaseDone(phase);
            const count = phaseCounts[index] ?? 0;
            const prev = phaseCounts[index - 1] ?? 0;
            const delta = count - prev;
            // Only show the comparison once there is something to compare.
            const showDelta = index > 0 && (count > 0 || prev > 0);
            return (
              <button
                key={index}
                type="button"
                onClick={() => onSelect(index)}
                className={classNames(
                  "flex flex-1 flex-col items-center justify-center gap-0.5 rounded-lg border px-2 py-2 text-sm font-black transition-colors",
                  selected === index ? "border-workshop-500 ring-2 ring-workshop-500/30" : "border-steel-100",
                  phase.bypassed ? "bg-steel-100 text-steel-500" : done ? "bg-workshop-100 text-workshop-700" : "bg-white text-steel-500"
                )}
              >
                <span className="flex items-center gap-1.5">
                  {phase.bypassed ? <X size={15} /> : done ? <CheckCircle2 size={15} /> : <span className="h-3.5 w-3.5 rounded-full border border-steel-300" />}
                  {t("Phase {n}", { n: index + 1 })}
                </span>
                <span className="text-[10px] font-bold uppercase tracking-wide text-steel-400">{PHASE_TIMES[index]}</span>
                <span className="flex items-center gap-1.5">
                  <span className="text-base text-steel-900">{phase.bypassed ? "—" : count}</span>
                  {showDelta && !phase.bypassed && (
                    <span className={classNames("rounded px-1 text-xs font-black", delta >= 0 ? "bg-workshop-100 text-workshop-700" : "bg-red-100 text-red-700")}>
                      {delta >= 0 ? `+${delta}` : delta}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        {/* Read-out + controls for the selected phase. The pallet count comes
            straight from the quantity grid below (entered per phase). */}
        <div className="grid gap-3 rounded-lg bg-steel-50 p-3 sm:grid-cols-[1fr_auto]">
          <div className="grid gap-1">
            <p className="flex items-center gap-1.5 text-sm font-black"><FileSpreadsheet size={16} /> {t("Phase {n} pallets", { n: selected + 1 })} <span className="font-bold text-steel-500">{PHASE_TIMES[selected]}</span></p>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-black text-steel-900">{active.bypassed ? "—" : phaseCounts[selected] ?? 0}</span>
              {!active.bypassed && (phaseQcCounts[selected] ?? 0) > 0 && (
                <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-black text-red-700">-{phaseQcCounts[selected]} QC</span>
              )}
            </div>
          </div>
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => updatePhase(selected, { bypassed: !active.bypassed })}
              className={classNames("field font-black", active.bypassed ? "bg-amber-100 text-amber-700" : "text-steel-500")}
            >
              {active.bypassed ? t("Bypassed ✓") : t("Bypass")}
            </button>
          </div>
          <div className="sm:col-span-2">
            <p className="mb-1 flex items-center gap-1.5 text-sm font-black">
              <Camera size={15} /> {t("Phase {n} photos", { n: selected + 1 })}
              {activePhotos.length > 0 && <span className="font-bold text-steel-500">({activePhotos.length})</span>}
            </p>
            {activePhotos.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {activePhotos.map((photo, photoIndex) => {
                  const broken = brokenPhotos.includes(photo);
                  return (
                  <div key={photoIndex} className="relative shrink-0">
                    {broken ? (
                      <div className="flex h-16 w-24 flex-col items-center justify-center rounded bg-amber-50 px-1 text-center text-[10px] font-black leading-tight text-amber-700 ring-1 ring-amber-200">
                        {t("Can't preview — remove & re-add")}
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setZoomPhoto(photo)}
                        className="group relative block rounded ring-1 ring-steel-200 transition-transform hover:scale-105"
                        title={t("Tap to enlarge")}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={photo}
                          alt={`Phase ${selected + 1} photo ${photoIndex + 1}`}
                          className="h-16 w-16 rounded object-cover"
                          onError={() => setBrokenPhotos((current) => (current.includes(photo) ? current : [...current, photo]))}
                        />
                        <span className="absolute inset-0 flex items-center justify-center rounded bg-black/0 text-transparent transition-colors group-hover:bg-black/40 group-hover:text-white">
                          <Maximize2 size={18} />
                        </span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => removePhasePhoto(selected, photo)}
                      aria-label="Remove photo"
                      className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-red-700 text-white shadow ring-2 ring-white"
                    >
                      <X size={13} />
                    </button>
                  </div>
                  );
                })}
              </div>
            )}
            <DropZone
              onFiles={(dropped) => handlePhasePhoto(selected, dropped)}
              label={activePhotos.length > 0 ? t("Add more photos") : t("Drag & drop or tap to add phase photos")}
            />
          </div>
        </div>
      </div>

      {/* Side panel: who has reached each phase. A repairer appears under a
          phase only once they have completed every phase before it. The list
          scrolls on its own so every name shows, and the most-completed phase
          sits at the top. */}
      <div className="grid max-h-[80vh] content-start gap-3 overflow-y-auto rounded-lg bg-steel-900 p-3 text-white">
        <p className="sticky top-0 -mx-3 -mt-3 bg-steel-900 px-3 pb-2 pt-3 text-xs font-black uppercase tracking-wide text-steel-100">{t("Phase check-ins")}</p>
        {(() => {
          // A phase counts as complete only once it has a photo (a bypassed
          // phase needs no photo, so it's complete too). Classify each repairer:
          //   completed  -> every phase is complete
          //   incomplete -> started, but at least one phase still needs a photo
          //   not started -> nothing entered at all
          const phaseComplete = (phase: EntryPhase | undefined) => phasePhotos(phase).length > 0 || Boolean(phase?.bypassed);
          const phaseActive = (phase: EntryPhase | undefined) =>
            (phase?.amount ?? 0) > 0 || Boolean(phase?.bypassed) || phasePhotos(phase).length > 0;
          const hasActivity = (member: typeof crew[number]) => (member.phases ?? []).some((phase) => phaseActive(phase ?? undefined));
          const allComplete = (member: typeof crew[number]) => phases.every((_p, i) => phaseComplete(member.phases?.[i] ?? undefined));
          const byFirstName = (a: typeof crew[number], b: typeof crew[number]) => {
            const first = (name: string) => name.trim().split(/\s+/)[0].toLowerCase();
            return first(a.name).localeCompare(first(b.name)) || a.name.localeCompare(b.name);
          };

          const completed = crew.filter((m) => hasActivity(m) && allComplete(m)).sort(byFirstName);
          const incomplete = crew.filter((m) => hasActivity(m) && !allComplete(m)).sort(byFirstName);
          const notStarted = crew.filter((m) => !hasActivity(m)).sort(byFirstName);

          const groups = [
            { key: "completed", label: t("Completed"), members: completed, dim: false,
              icon: <CheckCircle2 size={14} className="shrink-0 text-safety-400" /> },
            { key: "incomplete", label: t("Incomplete"), members: incomplete, dim: false,
              icon: <span className="h-3.5 w-3.5 shrink-0 rounded-full bg-amber-400" /> },
            { key: "not-started", label: t("Not started"), members: notStarted, dim: true,
              icon: <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-steel-500" /> }
          ];

          return groups.map((group) => (
            <div key={group.key} className="grid gap-1">
              <div className="flex items-center justify-between">
                <span className={classNames("text-sm font-black", group.dim && "text-steel-400")}>{group.label}</span>
                {group.members.length > 0 && (
                  <span className="text-xs font-bold text-steel-400">{group.members.length}</span>
                )}
              </div>
              {group.members.length === 0 ? (
                <p className="rounded bg-white/5 px-3 py-1.5 text-xs font-bold text-steel-400">{t("None")}</p>
              ) : (
                group.members.map((member) => {
                  // Which phases are done (photo/bypassed) vs still incomplete.
                  const donePhases = phases
                    .map((_p, i) => (phaseComplete(member.phases?.[i] ?? undefined) ? i + 1 : null))
                    .filter((n): n is number => n !== null);
                  const pendingPhases = phases
                    .map((_p, i) => (!phaseComplete(member.phases?.[i] ?? undefined) ? i + 1 : null))
                    .filter((n): n is number => n !== null);
                  return (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => onSelectRepairer(member.id)}
                    className={classNames(
                      "flex items-center justify-between gap-2 rounded px-3 py-1.5 text-left transition-colors",
                      member.id === activeId ? "bg-white/15 ring-1 ring-workshop-400" : "bg-white/5 hover:bg-white/10"
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      {member.photoDataUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={member.photoDataUrl} alt="" className="h-6 w-6 shrink-0 rounded object-cover" />
                      ) : (
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-white/20 text-[10px] font-black">
                          {member.name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()}
                        </span>
                      )}
                      <span className={classNames("min-w-0 truncate text-sm font-black", group.dim && "text-steel-300")}>{member.name}</span>
                    </span>
                    {group.key === "completed" && donePhases.length > 0 ? (
                      <span className="flex shrink-0 items-center gap-1">
                        {donePhases.map((n) => (
                          <span key={n} className="rounded bg-safety-400/20 px-1.5 py-0.5 text-[10px] font-black text-safety-300">P{n}</span>
                        ))}
                      </span>
                    ) : group.key === "incomplete" && pendingPhases.length > 0 ? (
                      <span className="flex shrink-0 items-center gap-1">
                        {pendingPhases.map((n) => (
                          <span key={n} className="rounded bg-amber-400/20 px-1.5 py-0.5 text-[10px] font-black text-amber-300">P{n}</span>
                        ))}
                      </span>
                    ) : (
                      group.icon
                    )}
                  </button>
                  );
                })
              )}
            </div>
          ));
        })()}
      </div>

      {/* Photo viewer so count sheets can be read up close. Two modes:
          - Full screen: covers everything; click the backdrop or press Escape to close.
          - Side by side: docks to the right half so the count sheet stays open
            while the numbers get typed into the form on the left. */}
      {zoomPhoto && (() => {
        const photoUrl = zoomPhoto;
        const toolbarButtons = (
          <>
            <button
              type="button"
              onClick={() => setSplitView((value) => !value)}
              aria-label={splitView ? t("Full screen") : t("Side by side")}
              title={splitView ? t("Full screen") : t("Side by side")}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur transition-colors hover:bg-white/30"
            >
              {splitView ? <Maximize2 size={20} /> : <Columns2 size={20} />}
            </button>
            <button
              type="button"
              onClick={() => adjustZoom(-0.5)}
              disabled={zoomScale <= 1}
              aria-label={t("Zoom out")}
              title={t("Zoom out")}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur transition-colors hover:bg-white/30 disabled:opacity-40"
            >
              <ZoomOut size={20} />
            </button>
            <button
              type="button"
              onClick={() => adjustZoom(0.5)}
              disabled={zoomScale >= 5}
              aria-label={t("Zoom in")}
              title={t("Zoom in")}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur transition-colors hover:bg-white/30 disabled:opacity-40"
            >
              <ZoomIn size={20} />
            </button>
            <button
              type="button"
              onClick={() => setZoomRotation((value) => value - 90)}
              aria-label={t("Rotate left")}
              title={t("Rotate left")}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur transition-colors hover:bg-white/30"
            >
              <RotateCcw size={20} />
            </button>
            <button
              type="button"
              onClick={() => setZoomRotation((value) => value + 90)}
              aria-label={t("Rotate right")}
              title={t("Rotate right")}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur transition-colors hover:bg-white/30"
            >
              <RotateCw size={20} />
            </button>
            <button
              type="button"
              onClick={() => openImageInNewTab(photoUrl)}
              aria-label={t("Open in new tab")}
              title={t("Open in new tab")}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur transition-colors hover:bg-white/30"
            >
              <ExternalLink size={20} />
            </button>
            <button
              type="button"
              onClick={() => downloadPhoto(photoUrl, zoomRotation, `count-sheet-${Date.now()}.jpg`)}
              aria-label={t("Download")}
              title={t("Download")}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur transition-colors hover:bg-white/30"
            >
              <Download size={20} />
            </button>
            <button
              type="button"
              onClick={() => setZoomPhoto(null)}
              aria-label={t("Close (Esc)")}
              title={t("Close (Esc)")}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur transition-colors hover:bg-white/30"
            >
              <X size={22} />
            </button>
          </>
        );
        const photoImg = (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={photoUrl}
            alt="Phase photo"
            draggable={false}
            style={{
              transform: `translate(${zoomOffset.x}px, ${zoomOffset.y}px) rotate(${zoomRotation}deg) scale(${zoomScale})`,
              cursor: zoomScale > 1 ? (isPanning ? "grabbing" : "grab") : "auto",
              touchAction: "none"
            }}
            className={classNames(
              "max-h-full max-w-full rounded-lg object-contain shadow-2xl",
              isPanning ? "" : "transition-transform"
            )}
            onClick={(event) => event.stopPropagation()}
            onWheel={(event) => adjustZoom(event.deltaY < 0 ? 0.25 : -0.25)}
            onPointerDown={(event) => {
              if (zoomScale <= 1) return;
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              panStart.current = { x: event.clientX, y: event.clientY, originX: zoomOffset.x, originY: zoomOffset.y };
              setIsPanning(true);
            }}
            onPointerMove={(event) => {
              if (!panStart.current) return;
              setZoomOffset({
                x: panStart.current.originX + (event.clientX - panStart.current.x),
                y: panStart.current.originY + (event.clientY - panStart.current.y)
              });
            }}
            onPointerUp={() => {
              panStart.current = null;
              setIsPanning(false);
            }}
            onPointerCancel={() => {
              panStart.current = null;
              setIsPanning(false);
            }}
          />
        );
        return splitView ? (
          <div
            className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-white/10 bg-black/95 shadow-2xl sm:w-[46vw] [animation:board-rise_0.2s_ease-out]"
            role="dialog"
          >
            <div className="flex flex-wrap items-center justify-end gap-2 border-b border-white/10 px-3 py-2">{toolbarButtons}</div>
            <div className="relative flex flex-1 items-center justify-center overflow-hidden p-3">{photoImg}</div>
          </div>
        ) : (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 [animation:board-rise_0.2s_ease-out]"
            onClick={() => setZoomPhoto(null)}
            role="dialog"
            aria-modal="true"
          >
            {/* Toolbar: side-by-side, zoom, rotate, download, close. */}
            <div className="absolute right-3 top-3 z-10 flex flex-wrap items-center justify-end gap-2" onClick={(event) => event.stopPropagation()}>{toolbarButtons}</div>
            {photoImg}
          </div>
        );
      })()}
    </div>
  );
}

function ProductionEntry({
  darkMode,
  form,
  saveStatus,
  selectedEmployee,
  employees,
  entries,
  locations,
  shifts,
  palletTypes,
  calculation,
  onEmployeeChange,
  onYardChange,
  onDateChange,
  onFormChange,
  onQuantityChange,
  onPhaseNotesChange,
  onStationChange,
  onSave,
  hideYardManager,
  hidePricing
}: {
  darkMode: boolean;
  form: EntryForm;
  saveStatus: string;
  selectedEmployee?: Employee;
  employees: Employee[];
  entries: DailyEntry[];
  locations: Location[];
  shifts: Shift[];
  palletTypes: PalletType[];
  calculation: ReturnType<typeof calculateEntry>;
  onEmployeeChange: (employeeId: string) => void;
  onYardChange: (locationId: string) => void;
  onDateChange: (date: string) => void;
  onFormChange: <T extends keyof EntryForm>(key: T, value: EntryForm[T]) => void;
  onQuantityChange: (phaseIndex: number, palletTypeId: string, quantity: number, parts?: number[]) => void;
  // Updates the note for a single phase (kept per repairer per phase).
  onPhaseNotesChange: (phaseIndex: number, value: string) => void;
  // Updates a repairer's station assignment (persisted on the roster).
  onStationChange: (employeeId: string, patch: Partial<Employee>) => void;
  onSave: () => void | Promise<void>;
  // When a Manager is signed in, the Yard Manager picker is hidden entirely.
  hideYardManager?: boolean;
  // Managers don't need pay figures: hide the Rate/Total Earned columns so the
  // pallet table fits a phone screen without scrolling sideways.
  hidePricing?: boolean;
}) {
  const { t } = useT();
  // The repairer the station dropdowns read from must be the exact one they
  // write to (form.employeeId) — not the fallback selectedEmployee, which can
  // differ — otherwise the choice never sticks.
  const stationEmployee = employees.find((employee) => employee.id === form.employeeId) ?? selectedEmployee;
  const yardRepairers = employees.filter((employee) => employee.locationId === form.locationId && employee.role !== "supervisor");
  const yardManagers = employees.filter((employee) => employee.locationId === form.locationId && employee.role === "supervisor");
  const displayedPallets = palletsForYard(palletTypes, form.locationId);
  // Manager view drops the price columns and uses compact cells so the table
  // fits a phone screen with no sideways scroll.
  const cellPad = hidePricing ? "p-2" : "p-3";

  // Each repairer's phase check-ins for the selected day + yard. Saved entries
  // are the source of truth; the repairer being edited reflects the live form.
  const savedPhasesByEmployee = new Map<string, EntryPhase[]>();
  entries
    .filter((entry) => entry.date === form.date && entry.locationId === form.locationId)
    .forEach((entry) => {
      if (entry.phases?.length) savedPhasesByEmployee.set(entry.employeeId, normalizePhases(entry.phases));
    });
  const activePhases = normalizePhases(form.phases);
  const crew = yardRepairers.map((employee) => ({
    id: employee.id,
    name: employee.name,
    photoDataUrl: employee.photoDataUrl,
    phases: employee.id === form.employeeId ? activePhases : savedPhasesByEmployee.get(employee.id) ?? null
  }));

  // Which phase the quantity grid is currently editing. Each phase keeps its
  // own quantities; switching phases shows that phase's numbers (0 if fresh).
  const [selectedPhase, setSelectedPhase] = useState(0);
  // Save button feedback so it's obvious the save happened: the button shows a
  // spinner while saving, then a green "Saved" tick for a moment.
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const savedTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(savedTimer.current), []);
  async function handleSaveClick() {
    if (saveState === "saving") return;
    setSaveState("saving");
    try {
      await onSave();
      setSaveState("saved");
      window.clearTimeout(savedTimer.current);
      savedTimer.current = window.setTimeout(() => setSaveState("idle"), 2500);
    } catch {
      setSaveState("idle");
    }
  }
  // Pallets produced per phase (QC deductions excluded) for the productivity
  // figures shown on each phase tab.
  const phaseCounts = activePhases.map((phase) => phasePalletCount(phase, palletTypes));
  const phaseQcCounts = activePhases.map((phase) => phaseQcCount(phase, palletTypes));
  const phaseLines = activePhases[selectedPhase]?.lines ?? [];

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Avatar employee={selectedEmployee} size="lg" />
          <div>
            <h2 className="text-2xl font-black">{t("Daily Production Grid")}</h2>
            <p className={classNames("text-sm", darkMode ? "text-steel-100" : "text-steel-500")}>{t(saveStatus)}</p>
          </div>
        </div>
        {/* Managers don't see pay figures — just the pallet count. */}
        <div className={classNames("grid grid-cols-2 gap-2", hidePricing ? "sm:grid-cols-1" : "sm:grid-cols-4")}>
          <Metric label={t("Pallets")} value={wholeNumber(calculation.quantity)} />
          {!hidePricing && <Metric label="Piece Pay" value={currency(calculation.pieceEarnings)} />}
          {!hidePricing && <Metric label="Make-up" value={currency(calculation.additionalOwed)} />}
          {!hidePricing && <Metric label="Total" value={currency(calculation.totalPay)} />}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
        <Label title={t("Date")} icon={<CalendarDays size={17} />}>
          <CalendarField
            single
            value={{ mode: "day", start: form.date, end: form.date }}
            onChange={(selection) => onDateChange(selection.start)}
          />
        </Label>
        <Label title={t("Yard")} icon={<MapPin size={17} />}>
          <select className="field" value={form.locationId} onChange={(event) => onYardChange(event.target.value)}>
            {locations.filter((location) => location.active).map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </Label>
        {!hideYardManager && (
          <Label title={t("Yard Manager")} icon={<ShieldCheck size={17} />}>
            <select className="field" value={form.yardManagerId ?? ""} onChange={(event) => onFormChange("yardManagerId", event.target.value)}>
              <option value="">{t("— No manager —")}</option>
              {yardManagers.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.name}
                </option>
              ))}
            </select>
          </Label>
        )}
        <Label title={t("Repairer")} icon={<UserRound size={17} />}>
          <select className="field" value={form.employeeId} onChange={(event) => onEmployeeChange(event.target.value)}>
            {yardRepairers.length === 0 && <option value="">{t("No repairers in this yard")}</option>}
            {yardRepairers.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.name}
              </option>
            ))}
          </select>
        </Label>
        {/* Station assignment for the selected repairer. Saved on the repairer,
            so it stays until changed. */}
        <Label title={t("Station")} icon={<MapPin size={17} />}>
          <select
            className="field"
            value={stationEmployee?.station ?? ""}
            disabled={!stationEmployee}
            onChange={(event) => stationEmployee && onStationChange(stationEmployee.id, { station: (event.target.value || undefined) as Employee["station"] })}
          >
            <option value="">{t("— None —")}</option>
            <option value="sorter">{t("Sorter")}</option>
            <option value="repair">{t("Repair Line")}</option>
          </select>
        </Label>
        <Label title={t("Spot")} icon={<UserRound size={17} />}>
          <select
            className="field"
            value={stationEmployee?.stationSpot ?? ""}
            disabled={!stationEmployee?.station}
            onChange={(event) => stationEmployee && onStationChange(stationEmployee.id, { stationSpot: event.target.value ? Number(event.target.value) : undefined })}
          >
            <option value="">{t("— None —")}</option>
            {[1, 2, 3, 4, 5].map((spot) => (
              <option key={spot} value={spot}>
                {t("Spot {n}", { n: spot })}
              </option>
            ))}
          </select>
        </Label>
      </div>

      <PhaseTracker
        repairerName={selectedEmployee?.name ?? "Repairer"}
        phases={activePhases}
        onChange={(next) => onFormChange("phases", next)}
        crew={crew}
        activeId={form.employeeId}
        onSelectRepairer={onEmployeeChange}
        selected={selectedPhase}
        onSelect={setSelectedPhase}
        phaseCounts={phaseCounts}
        phaseQcCounts={phaseQcCounts}
      />

      {SHOW_TIME_FIELDS && (
      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
        <Label title="Shift" icon={<Clock size={17} />}>
          <select className="field" value={form.shift} onChange={(event) => onFormChange("shift", event.target.value as Shift)}>
            {shifts.map((shift) => (
              <option key={shift} value={shift}>
                {shift}
              </option>
            ))}
          </select>
        </Label>
        <Label title="Clock In" icon={<Clock size={17} />}>
          <select className="field" value={form.clockIn} onChange={(event) => onFormChange("clockIn", event.target.value)}>
            {timeOptions.map((time) => (
              <option key={time} value={time}>
                {time}
              </option>
            ))}
          </select>
        </Label>
        <Label title="Clock Out" icon={<Clock size={17} />}>
          <select className="field" value={form.clockOut} onChange={(event) => onFormChange("clockOut", event.target.value)}>
            {timeOptions.map((time) => (
              <option key={time} value={time}>
                {time}
              </option>
            ))}
          </select>
        </Label>
        <Label title="Hours" icon={<Clock size={17} />}>
          <input className="field" inputMode="decimal" type="number" min="0" step="0.25" value={form.manualHours} onChange={(event) => onFormChange("manualHours", Number(event.target.value))} />
        </Label>
        <Label title="Break / Lunch" icon={<Clock size={17} />}>
          <select className="field" value={form.breakProfile} onChange={(event) => onFormChange("breakProfile", event.target.value as BreakProfile)}>
            <option value="standard">15 paid break + 30 unpaid lunch</option>
            <option value="paidLunch">Paid 30-minute lunch</option>
            <option value="noLunch">No lunch deduction</option>
          </select>
        </Label>
      </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-black text-steel-900">
          {t("Phase {n} quantities", { n: selectedPhase + 1 })} <span className="font-bold text-workshop-700">{PHASE_TIMES[selectedPhase]}</span>
          <span className="ml-1 font-bold text-steel-500">{t("— enter this phase's pallets, then switch phases above")}</span>
        </p>
        <span className="rounded bg-workshop-100 px-2.5 py-1 text-xs font-black text-workshop-700">{t("{n} pallets", { n: phaseCounts[selectedPhase] })}</span>
      </div>

      <div className="overflow-hidden rounded border border-steel-100 bg-white text-steel-900">
        <div className="overflow-x-auto">
          <table className={classNames("w-full text-left text-sm", hidePricing ? "table-fixed" : "min-w-[760px]")}>
            <thead className="bg-steel-900 text-white">
              <tr>
                {!hidePricing && <th className="p-3">{t("Category")}</th>}
                <th className={cellPad}>{t("Pallet Description")}</th>
                {!hidePricing && <th className="p-3">{t("Rate")}</th>}
                <th className={classNames(cellPad, hidePricing && "w-[190px]")}>{t("Quantity")}</th>
                {!hidePricing && <th className="p-3">{t("Total Earned")}</th>}
              </tr>
            </thead>
            <tbody>
              {displayedPallets.map((pallet) => {
                const line = phaseLines.find((item) => item.palletTypeId === pallet.id);
                const quantity = line?.quantity ?? 0;
                const earned = quantity * pallet.rate;

                return (
                  <tr key={pallet.id} className="border-t border-steel-100 even:bg-steel-50">
                    {!hidePricing && <td className={classNames(cellPad, "font-black")}>{pallet.category}</td>}
                    <td className={classNames(cellPad, hidePricing && "break-words")}>
                      {hidePricing ? (
                        <>
                          <span className="block text-steel-500">{pallet.code}</span>
                          <span className="block font-black">{pallet.description}</span>
                        </>
                      ) : (
                        <>
                          <span className="block font-black">{pallet.code}</span>
                          <span className="text-steel-500">{pallet.description}</span>
                        </>
                      )}
                    </td>
                    {!hidePricing && (
                      <td className={classNames("p-3 font-black", pallet.rate < 0 ? "text-red-700" : "text-workshop-700")}>{currency(pallet.rate)}</td>
                    )}
                    <td className={cellPad}>
                      {line?.parts && line.parts.length > 1 ? (
                        // Two boxes: the formula on the left and the sum on the
                        // right. The formula box stays one line when it fits and
                        // wraps to more lines only when it can't — so the whole
                        // equation is always visible without horizontal scrolling.
                        <div className="flex items-center gap-1.5">
                          <QuantityInput
                            mode="parts"
                            multiline
                            className="min-w-0 flex-1 resize-none overflow-hidden rounded border border-steel-200 bg-white px-2 py-2 text-center text-sm font-black leading-snug text-steel-900 outline-none focus:border-workshop-500"
                            value={quantity}
                            parts={line.parts}
                            onCommit={(sum, parts) => onQuantityChange(selectedPhase, pallet.id, sum, parts)}
                          />
                          <span className="shrink-0 text-lg font-black text-steel-400">=</span>
                          <input
                            readOnly
                            className="w-20 shrink-0 rounded border border-steel-200 bg-steel-50 px-1 py-2.5 text-center font-black text-steel-900 outline-none"
                            value={quantity}
                          />
                        </div>
                      ) : (
                        // Default box: a normal small box aligned right. Type the
                        // numbers here (use the keypad's + to add several together)
                        // and the row splits into the formula + sum boxes above.
                        <div className="flex justify-end">
                          <QuantityInput
                            className="w-20 rounded border border-steel-200 bg-white px-1 py-2.5 text-center font-black text-steel-900 outline-none focus:border-workshop-500"
                            value={quantity}
                            parts={line?.parts}
                            onCommit={(sum, parts) => onQuantityChange(selectedPhase, pallet.id, sum, parts)}
                          />
                        </div>
                      )}
                    </td>
                    {!hidePricing && (
                      <td className={classNames("p-3 text-lg font-black", earned < 0 ? "text-red-700" : "text-steel-900")}>{currency(earned)}</td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pay-rate breakdown is hidden from managers. */}
      {!hidePricing && (
        <div className={classNames("grid gap-2 rounded border p-3 text-sm", darkMode ? "border-white/10 bg-white/[0.08]" : "border-steel-100 bg-steel-50")}>
          <div className="flex justify-between">
            <span>Hourly equivalent</span>
            <strong>{currency(calculation.hourlyEquivalent)}/hr</strong>
          </div>
          <div className="flex justify-between">
            <span>Minimum required</span>
            <strong>{currency(calculation.minimumWageRequired)}</strong>
          </div>
          <div className="flex justify-between">
            <span>Daily overtime</span>
            <strong>{calculation.overtimeHours.toFixed(2)} hrs</strong>
          </div>
        </div>
      )}

      {/* Notes are kept per repairer per phase — the box shows and edits the
          note for the phase selected above, so switching phases or repairers
          shows that phase's own note instead of one shared note for everyone. */}
      <Label title={t("Notes — Phase {n}", { n: selectedPhase + 1 })} icon={<FileSpreadsheet size={17} />}>
        <textarea
          className="field min-h-20 resize-none"
          value={activePhases[selectedPhase]?.notes ?? ""}
          onChange={(event) => onPhaseNotesChange(selectedPhase, event.target.value)}
          placeholder={t("Supervisor notes, trailer, customer, or repair issues")}
        />
      </Label>

      <button
        type="button"
        disabled={saveState === "saving"}
        aria-live="polite"
        className={classNames(
          "touch-target flex items-center justify-center gap-2 rounded px-4 py-3 text-lg font-black text-white shadow-panel transition-colors",
          saveState === "saved" ? "bg-[#1f7a4d]" : "bg-workshop-500",
          saveState === "saving" && "opacity-80"
        )}
        onClick={handleSaveClick}
      >
        {saveState === "saving" ? (
          <>
            <Loader2 size={22} className="animate-spin" />
            {t("Saving…")}
          </>
        ) : saveState === "saved" ? (
          <>
            <CheckCircle2 size={22} />
            {t("Saved!")}
          </>
        ) : (
          <>
            <Save size={22} />
            {t("Save Daily Grid")}
          </>
        )}
      </button>
    </div>
  );
}

function CountSheetsModule({
  countSheets,
  entries,
  locations,
  shifts,
  onCreate,
  onUpdate,
  onDelete
}: {
  countSheets: CountSheet[];
  entries: DailyEntry[];
  locations: Location[];
  shifts: Shift[];
  onCreate: (input: { date: string; locationId: string; shift: Shift; uploadedBy: string; notes: string; files: File[] }) => Promise<string>;
  onUpdate: (id: string, patch: Partial<CountSheet>) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
}) {
  const [roleMode, setRoleMode] = useState<"counter" | "admin">("counter");
  const [date, setDate] = useState(today);
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "fontana");
  const [shift, setShift] = useState<Shift>(shifts[0] ?? "AM");
  const [uploadedBy, setUploadedBy] = useState("Counter");
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const filePreviews = useMemo(() => files.map((file) => ({ file, url: URL.createObjectURL(file) })), [files]);
  useEffect(() => () => filePreviews.forEach((preview) => URL.revokeObjectURL(preview.url)), [filePreviews]);
  const [statusMessage, setStatusMessage] = useState("Ready for count sheet photos.");
  const [isSaving, setIsSaving] = useState(false);
  const [selectedSheetId, setSelectedSheetId] = useState<string | null>(null);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(0);
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState<DateSelection>({ mode: "day", start: "", end: "" });
  const [locationFilter, setLocationFilter] = useState("all");
  const [shiftFilter, setShiftFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"All" | CountSheetStatus>("All");
  const [uploadedByFilter, setUploadedByFilter] = useState("");
  const [sortMode, setSortMode] = useState<"newest" | "oldest" | "date-asc" | "date-desc">("newest");

  const filteredSheets = countSheets
    .filter((sheet) => {
      const location = locations.find((item) => item.id === sheet.locationId)?.name ?? sheet.locationId;
      const query = search.toLowerCase();
      if (dateFilter.start) {
        if (dateFilter.mode === "day" && sheet.date !== dateFilter.start) return false;
        if (dateFilter.mode === "week" && getWeekKey(sheet.date) !== getWeekKey(dateFilter.start)) return false;
        if (dateFilter.mode === "range" && (sheet.date < dateFilter.start || sheet.date > dateFilter.end)) return false;
      }
      if (locationFilter !== "all" && sheet.locationId !== locationFilter) return false;
      if (shiftFilter !== "all" && sheet.shift !== shiftFilter) return false;
      if (statusFilter !== "All" && sheet.status !== statusFilter) return false;
      if (uploadedByFilter && !sheet.uploadedBy.toLowerCase().includes(uploadedByFilter.toLowerCase())) return false;
      return `${sheet.date} ${location} ${sheet.shift} ${sheet.uploadedBy} ${sheet.notes ?? ""}`.toLowerCase().includes(query);
    })
    .sort((a, b) => {
      if (sortMode === "oldest") return a.uploadTime.localeCompare(b.uploadTime);
      if (sortMode === "date-asc") return a.date.localeCompare(b.date);
      if (sortMode === "date-desc") return b.date.localeCompare(a.date);
      return b.uploadTime.localeCompare(a.uploadTime);
    });

  const galleryStats = {
    total: filteredSheets.length,
    photos: filteredSheets.reduce((total, sheet) => total + sheet.photos.length, 0),
    pending: filteredSheets.filter((sheet) => sheet.status === "Pending").length,
    approved: filteredSheets.filter((sheet) => sheet.status === "Approved").length,
    rejected: filteredSheets.filter((sheet) => sheet.status === "Rejected").length
  };

  const selectedSheet = countSheets.find((sheet) => sheet.id === selectedSheetId) ?? null;
  const linkedEntries = selectedSheet ? getLinkedEntries(entries, selectedSheet) : [];

  function handleFiles(selected: FileList | File[] | null) {
    if (!selected) return;
    setFiles((current) => [...current, ...Array.from(selected).filter((file) => file.type.startsWith("image/"))]);
  }

  async function saveCountSheet() {
    if (files.length === 0) {
      setStatusMessage("Add at least one count sheet photo before saving.");
      return;
    }

    setIsSaving(true);
    const message = await onCreate({ date, locationId, shift, uploadedBy, notes, files });
    setStatusMessage(message);
    setFiles([]);
    setNotes("");
    setIsSaving(false);
  }

  async function updateStatus(sheet: CountSheet, nextStatus: CountSheetStatus) {
    const now = new Date().toISOString();
    await Promise.resolve(
      onUpdate(sheet.id, {
        status: nextStatus,
        approvedBy: nextStatus === "Approved" ? "Admin" : undefined,
        approvedAt: nextStatus === "Approved" ? now : undefined,
        rejectedBy: nextStatus === "Rejected" ? "Admin" : undefined,
        rejectedAt: nextStatus === "Rejected" ? now : undefined
      })
    );
    setStatusMessage(`Count sheet marked ${nextStatus.toLowerCase()}.`);
  }

  function clearFilters() {
    setSearch("");
    setDateFilter({ mode: "day", start: "", end: "" });
    setLocationFilter("all");
    setShiftFilter("all");
    setStatusFilter("All");
    setUploadedByFilter("");
    setSortMode("newest");
  }

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-black">Count Sheets</h2>
          <p className="text-sm text-steel-500">Upload yard photos and link count documentation by date, location, and shift.</p>
        </div>
        <div className="grid grid-cols-2 gap-2 rounded border border-steel-100 bg-steel-50 p-1">
          <button type="button" className={classNames("touch-target rounded px-4 font-black", roleMode === "counter" ? "bg-workshop-500 text-white" : "text-steel-700")} onClick={() => setRoleMode("counter")}>
            Counter
          </button>
          <button type="button" className={classNames("touch-target rounded px-4 font-black", roleMode === "admin" ? "bg-steel-900 text-white" : "text-steel-700")} onClick={() => setRoleMode("admin")}>
            Admin
          </button>
        </div>
      </div>

      <SaveNotice message={statusMessage} error="" />

      <div className="grid gap-4 lg:grid-cols-[420px_1fr]">
        <div className="grid gap-4 rounded border border-steel-100 bg-white p-4 text-steel-900">
          <div>
            <h3 className="text-xl font-black">Upload Photos</h3>
            <p className="text-sm text-steel-500">Counter mode keeps rates, payroll, and dollar amounts hidden.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Label title="Date" icon={<CalendarDays size={17} />}>
              <CalendarField
                single
                value={{ mode: "day", start: date, end: date }}
                onChange={(selection) => setDate(selection.start)}
              />
            </Label>
            <Label title="Shift" icon={<Clock size={17} />}>
              <select className="field" value={shift} onChange={(event) => setShift(event.target.value as Shift)}>
                {shifts.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </Label>
          </div>
          <Label title="Location" icon={<MapPin size={17} />}>
            <select className="field" value={locationId} onChange={(event) => setLocationId(event.target.value)}>
              {locations.filter((location) => location.active).map((location) => (
                <option key={location.id} value={location.id}>{location.name}</option>
              ))}
            </select>
          </Label>
          <Label title="Uploaded By" icon={<UserRound size={17} />}>
            <input className="field" value={uploadedBy} onChange={(event) => setUploadedBy(event.target.value)} placeholder="Counter name or station" />
          </Label>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="touch-target flex cursor-pointer items-center justify-center gap-2 rounded bg-workshop-500 px-4 py-3 text-lg font-black text-white">
              <Camera size={22} />
              Camera
              <input className="hidden" type="file" accept="image/*" capture="environment" multiple onChange={(event) => handleFiles(event.target.files)} />
            </label>
            <label className="touch-target flex cursor-pointer items-center justify-center gap-2 rounded bg-steel-900 px-4 py-3 text-lg font-black text-white">
              <ImagePlus size={22} />
              Photos
              <input className="hidden" type="file" accept="image/*" multiple onChange={(event) => handleFiles(event.target.files)} />
            </label>
          </div>
          <DropZone onFiles={handleFiles} label="Drag & drop count sheet photos here" />
          {files.length > 0 && (
            <div className="rounded border border-steel-100 bg-steel-50 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <strong>{files.length} photo{files.length === 1 ? "" : "s"} ready</strong>
                <button type="button" className="rounded bg-steel-200 px-3 py-1 text-sm font-black" onClick={() => setFiles([])}>Clear</button>
              </div>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {filePreviews.map(({ file, url }, index) => (
                  <div key={`${file.name}-${index}`} className="relative overflow-hidden rounded border border-steel-100 bg-white">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt={file.name} className="h-24 w-full object-cover" />
                    <button
                      type="button"
                      aria-label={`Remove ${file.name}`}
                      className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-steel-900/80 text-white"
                      onClick={() => setFiles((current) => current.filter((_, position) => position !== index))}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <Label title="Notes" icon={<FileSpreadsheet size={17} />}>
            <textarea className="field min-h-24 resize-none" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Line, table screen, trailer, or count notes" />
          </Label>
          <button type="button" disabled={isSaving} className="touch-target flex items-center justify-center gap-2 rounded bg-safety-400 px-4 py-3 text-lg font-black text-steel-900 disabled:bg-steel-300" onClick={saveCountSheet}>
            <Save size={22} />
            {isSaving ? "Saving..." : "Save Count Sheet"}
          </button>
        </div>

        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Metric label="Total Count Sheets" value={wholeNumber(galleryStats.total)} />
            <Metric label="Photos Uploaded" value={wholeNumber(galleryStats.photos)} />
            <Metric label="Pending Review" value={wholeNumber(galleryStats.pending)} />
            <Metric label="Approved" value={wholeNumber(galleryStats.approved)} />
            <Metric label="Rejected" value={wholeNumber(galleryStats.rejected)} />
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Label title="Search" icon={<Search size={17} />}>
              <input className="field" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search photos" />
            </Label>
            <Label title="Date" icon={<CalendarDays size={17} />}>
              <CalendarField allowClear value={dateFilter} onChange={setDateFilter} />
            </Label>
            <Label title="Location" icon={<MapPin size={17} />}>
              <select className="field" value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)}>
                <option value="all">All Locations</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>{location.name}</option>
                ))}
              </select>
            </Label>
            <Label title="Shift" icon={<Clock size={17} />}>
              <select className="field" value={shiftFilter} onChange={(event) => setShiftFilter(event.target.value)}>
                <option value="all">All Shifts</option>
                {shifts.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </Label>
            <Label title="Status" icon={<Filter size={17} />}>
              <select className="field" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "All" | CountSheetStatus)}>
                <option value="All">All Statuses</option>
                <option value="Pending">Pending</option>
                <option value="Approved">Approved</option>
                <option value="Rejected">Rejected</option>
              </select>
            </Label>
            <Label title="Uploaded By" icon={<UserRound size={17} />}>
              <input className="field" value={uploadedByFilter} onChange={(event) => setUploadedByFilter(event.target.value)} placeholder="Counter name" />
            </Label>
            <Label title="Sort" icon={<Filter size={17} />}>
              <select className="field" value={sortMode} onChange={(event) => setSortMode(event.target.value as "newest" | "oldest" | "date-asc" | "date-desc")}>
                <option value="newest">Newest First</option>
                <option value="oldest">Oldest First</option>
                <option value="date-asc">Date Ascending</option>
                <option value="date-desc">Date Descending</option>
              </select>
            </Label>
            <button type="button" className="touch-target flex items-center justify-center gap-2 rounded bg-steel-900 px-4 py-2 font-black text-white xl:self-end" onClick={clearFilters}>
              <X size={18} />
              Clear Filters
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {filteredSheets.map((sheet) => {
              const location = locations.find((item) => item.id === sheet.locationId)?.name ?? sheet.locationId;
              const matchingEntries = getLinkedEntries(entries, sheet);
              return (
                <div key={sheet.id} className="overflow-hidden rounded border border-steel-100 bg-white text-steel-900">
                  <button type="button" className="block w-full text-left" onClick={() => {
                    setSelectedSheetId(sheet.id);
                    setSelectedPhotoIndex(0);
                  }}>
                    <div className="aspect-[4/3] bg-steel-100">
                      {sheet.photos[0] ? (
                        <img className="h-full w-full object-cover" src={sheet.photos[0].url} alt={`${sheet.date} ${location} count sheet`} />
                      ) : (
                        <div className="flex h-full items-center justify-center font-black text-steel-500">No Photo</div>
                      )}
                    </div>
                    <div className="grid gap-1 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <strong>{sheet.date}</strong>
                        <StatusBadge status={sheet.status} />
                      </div>
                      <p className="text-sm text-steel-500">{location} · {sheet.shift}</p>
                      <p className="text-sm font-bold">{sheet.photos.length} photo{sheet.photos.length === 1 ? "" : "s"} · {matchingEntries.length} linked entries</p>
                    </div>
                  </button>
                  {roleMode === "admin" && (
                    <div className="grid grid-cols-3 gap-2 border-t border-steel-100 p-2">
                      <button type="button" className="rounded bg-workshop-500 px-2 py-2 text-xs font-black text-white" onClick={() => updateStatus(sheet, "Approved")}>Approve</button>
                      <button type="button" className="rounded bg-red-700 px-2 py-2 text-xs font-black text-white" onClick={() => updateStatus(sheet, "Rejected")}>Reject</button>
                      <button type="button" className="rounded bg-red-700 px-2 py-2 text-xs font-black text-white" onClick={() => onDelete(sheet.id)}>Delete</button>
                    </div>
                  )}
                </div>
              );
            })}
            {filteredSheets.length === 0 && (
              <div className="rounded border border-steel-100 bg-white p-5 text-center font-bold text-steel-500 sm:col-span-2 xl:col-span-3">No count sheets found.</div>
            )}
          </div>
        </div>
      </div>

      {selectedSheet && (
        <CountSheetViewer
          sheets={[selectedSheet]}
          photoIndex={selectedPhotoIndex}
          setPhotoIndex={setSelectedPhotoIndex}
          locations={locations}
          linkedEntries={linkedEntries}
          roleMode={roleMode}
          onClose={() => setSelectedSheetId(null)}
          onUpdate={onUpdate}
        />
      )}
    </div>
  );
}

function CountSheetViewer({
  sheets,
  photoIndex,
  setPhotoIndex,
  locations,
  linkedEntries,
  roleMode,
  onClose,
  onUpdate
}: {
  sheets: CountSheet[];
  photoIndex: number;
  setPhotoIndex: (index: number) => void;
  locations: Location[];
  linkedEntries: DailyEntry[];
  roleMode: "counter" | "admin";
  onClose: () => void;
  onUpdate: (id: string, patch: Partial<CountSheet>) => void | Promise<void>;
}) {
  const allPhotos = sheets.flatMap((sheet) => sheet.photos.map((photo) => ({ photo, sheet })));
  const selected = allPhotos[photoIndex] ?? allPhotos[0];
  const fallbackSheet = selected?.sheet ?? sheets[0];
  if (!fallbackSheet) return null;
  const sheet = fallbackSheet;
  const photo = selected?.photo;
  const [comments, setComments] = useState(sheet?.comments ?? "");
  const [zoom, setZoom] = useState(1);
  const location = locations.find((item) => item.id === sheet.locationId)?.name ?? sheet.locationId;

  useEffect(() => {
    setComments(sheet?.comments ?? "");
    setZoom(1);
  }, [sheet?.id, photoIndex]);

  return (
    <Modal title="Count Sheet Viewer" onClose={onClose}>
      <div className="grid gap-4">
        <div className="grid gap-2 sm:grid-cols-4 xl:grid-cols-6">
          <Metric label="Date" value={sheet.date} />
          <Metric label="Location" value={location} />
          <Metric label="Shift" value={sheet.shift} />
          <Metric label="Uploaded By" value={sheet.uploadedBy} />
          <Metric label="Status" value={sheet.status} />
          <Metric label="Photos" value={`${photoIndex + 1} / ${Math.max(1, allPhotos.length)}`} />
        </div>
        <div className="rounded border border-steel-100 bg-steel-50 p-3 text-sm text-steel-900">
          <strong className="block">Notes</strong>
          <span>{sheet.notes || "No notes"}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="touch-target rounded bg-steel-900 px-4 py-2 font-black text-white" onClick={() => setPhotoIndex(Math.max(0, photoIndex - 1))}>Previous</button>
          <button type="button" className="touch-target rounded bg-steel-900 px-4 py-2 font-black text-white" onClick={() => setPhotoIndex(Math.min(allPhotos.length - 1, photoIndex + 1))}>Next</button>
          <button type="button" className="touch-target rounded bg-steel-100 px-4 py-2 font-black text-steel-900" onClick={() => setZoom((value) => Math.max(0.5, Number((value - 0.25).toFixed(2))))}>Zoom Out</button>
          <button type="button" className="touch-target rounded bg-steel-100 px-4 py-2 font-black text-steel-900" onClick={() => setZoom((value) => Math.min(3, Number((value + 0.25).toFixed(2))))}>Zoom In</button>
          {photo && (
            <button type="button" className="touch-target flex items-center gap-2 rounded bg-steel-100 px-4 py-2 font-black text-steel-900" onClick={() => openImageInNewTab(photo.url)}>
              <ExternalLink size={18} />
              Open in new tab
            </button>
          )}
          {photo && (
            <a className="touch-target flex items-center gap-2 rounded bg-workshop-500 px-4 py-2 font-black text-white" href={photo.url} download={photo.fileName}>
              <Download size={18} />
              Download
            </a>
          )}
        </div>
        <div className="overflow-auto rounded border border-steel-100 bg-steel-900 p-2">
          {photo ? (
            <img className="mx-auto max-h-[72vh] max-w-none rounded bg-white" src={photo.url} alt={photo.fileName} style={{ transform: `scale(${zoom})`, transformOrigin: "top center" }} />
          ) : (
            <div className="p-8 text-center font-black text-white">No photos</div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {allPhotos.map((item, index) => (
            <button key={`${item.sheet.id}-${item.photo.id}`} type="button" className={classNames("h-16 w-16 overflow-hidden rounded border-2", index === photoIndex ? "border-safety-400" : "border-transparent")} onClick={() => setPhotoIndex(index)}>
              <img className="h-full w-full object-cover" src={item.photo.url} alt={item.photo.fileName} />
            </button>
          ))}
        </div>
        <div className="rounded border border-steel-100 bg-steel-50 p-3 text-sm text-steel-900">
          <strong className="block">Linked Production Entries</strong>
          <span>{linkedEntries.length} saved production entr{linkedEntries.length === 1 ? "y" : "ies"} match this date, location, and shift.</span>
        </div>
        {roleMode === "admin" && (
          <div className="grid gap-3">
            <Label title="Admin Comments" icon={<FileSpreadsheet size={17} />}>
              <textarea className="field min-h-24 resize-none" value={comments} onChange={(event) => setComments(event.target.value)} />
            </Label>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="touch-target rounded bg-workshop-500 px-4 py-2 font-black text-white" onClick={() => onUpdate(sheet.id, { comments, status: "Approved", approvedBy: "Admin", approvedAt: new Date().toISOString() })}>Approve</button>
              <button type="button" className="touch-target rounded bg-red-700 px-4 py-2 font-black text-white" onClick={() => onUpdate(sheet.id, { comments, status: "Rejected", rejectedBy: "Admin", rejectedAt: new Date().toISOString() })}>Reject</button>
              <button type="button" className="touch-target rounded bg-steel-900 px-4 py-2 font-black text-white" onClick={() => onUpdate(sheet.id, { comments })}>Save Comments</button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

// Admin-only live view that breaks production down by yard. Each yard is its
// own card listing the repairers working there and how many pallets they've
// made (QC deductions already subtracted), ranked high to low. Toggle a single
// yard to see just that crew, or "All Yards" to see all three side by side.
// Entries refresh on the app's normal live poll, so this updates on its own.
function LiveYards({
  settings,
  darkMode,
  entries,
  locations,
  palletTypes,
  employees,
  onSelectEmployee
}: {
  settings: PayrollSettings;
  darkMode: boolean;
  entries: DailyEntry[];
  locations: Location[];
  palletTypes: PalletType[];
  employees: Employee[];
  onSelectEmployee: (employeeId: string) => void;
}) {
  const { t } = useT();
  type Period = "today" | "week" | "all";
  const [period, setPeriod] = useState<Period>("today");
  const [yardFilter, setYardFilter] = useState<string>("all");

  const currentWeek = getWeekKey(today);
  const filteredEntries = useMemo(
    () =>
      entries.filter((entry) => {
        if (period === "today") return entry.date === today;
        if (period === "week") return getWeekKey(entry.date) === currentWeek;
        return true;
      }),
    [entries, period, currentWeek]
  );

  const report = useMemo(
    () => buildReport(filteredEntries, palletTypes, employees, locations, settings),
    [filteredEntries, palletTypes, employees, locations, settings]
  );

  // People grouped by their yard. buildReport already returns rows sorted by
  // pallet count (desc) and only for employees who logged production, so each
  // yard's list comes out ranked without another sort.
  const yardGroups = useMemo(() => {
    const byYard = new Map<string, { employee: Employee; quantity: number }[]>();
    for (const row of report.byEmployee) {
      const locationId = row.employee.locationId ?? "unassigned";
      const list = byYard.get(locationId) ?? [];
      list.push({ employee: row.employee as Employee, quantity: row.quantity });
      byYard.set(locationId, list);
    }
    return byYard;
  }, [report]);

  const visibleLocations = locations.filter((location) => yardFilter === "all" || location.id === yardFilter);
  const grandTotal = report.byEmployee.reduce((sum, row) => sum + row.quantity, 0);
  const periodLabel = period === "today" ? t("Today") : period === "week" ? t("This Week") : t("All Time");
  const singleYard = yardFilter !== "all";

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-black">{t("Live Yards")}</h2>
            <span className="flex items-center gap-1.5 rounded-full bg-workshop-100 px-2.5 py-1 text-xs font-black uppercase tracking-wide text-workshop-700">
              <span className="h-2 w-2 animate-pulse rounded-full bg-workshop-500" />
              {t("Live")}
            </span>
          </div>
          <p className={classNames("mt-0.5 text-sm", darkMode ? "text-steel-100" : "text-steel-500")}>
            {t("Per-yard production · {period} · {total} pallets", { period: periodLabel, total: wholeNumber(grandTotal) })}
          </p>
        </div>
        <div className={classNames("flex overflow-hidden rounded border text-sm font-black", darkMode ? "border-white/20" : "border-steel-200")}>
          {(["today", "week", "all"] as Period[]).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setPeriod(value)}
              className={classNames(
                "px-3 py-2",
                period === value ? "bg-workshop-500 text-white" : darkMode ? "bg-white/10 text-white" : "bg-white text-steel-600"
              )}
            >
              {value === "today" ? t("Today") : value === "week" ? t("This Week") : t("All Time")}
            </button>
          ))}
        </div>
      </div>

      <div className="no-scrollbar flex gap-2 overflow-x-auto">
        <YardToggle active={yardFilter === "all"} darkMode={darkMode} onClick={() => setYardFilter("all")}>{t("All Yards")}</YardToggle>
        {locations.map((location) => (
          <YardToggle key={location.id} active={yardFilter === location.id} darkMode={darkMode} onClick={() => setYardFilter(location.id)}>
            {location.name}
          </YardToggle>
        ))}
      </div>

      <div className={classNames("grid gap-4", singleYard ? "" : "md:grid-cols-2 xl:grid-cols-3")}>
        {visibleLocations.map((location) => (
          <LiveYardCard
            key={location.id}
            name={location.name}
            people={yardGroups.get(location.id) ?? []}
            darkMode={darkMode}
            dense={!singleYard}
            onSelectEmployee={onSelectEmployee}
          />
        ))}
      </div>
    </div>
  );
}

function YardToggle({ active, darkMode, onClick, children }: { active: boolean; darkMode: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={classNames(
        "shrink-0 rounded-full px-4 py-2 text-sm font-black transition-colors",
        active ? "bg-workshop-500 text-white shadow" : darkMode ? "bg-white/10 text-white/70 hover:text-white" : "bg-steel-100 text-steel-600 hover:text-steel-900"
      )}
    >
      {children}
    </button>
  );
}

function LiveYardCard({
  name,
  people,
  darkMode,
  dense,
  onSelectEmployee
}: {
  name: string;
  people: { employee: Employee; quantity: number }[];
  darkMode: boolean;
  dense: boolean;
  onSelectEmployee: (employeeId: string) => void;
}) {
  const { t } = useT();
  const total = people.reduce((sum, person) => sum + person.quantity, 0);
  return (
    <div className={classNames("flex min-w-0 flex-col rounded-xl border p-4", darkMode ? "border-white/10 bg-steel-900/40" : "border-steel-100 bg-steel-50")}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <MapPin size={18} className="shrink-0 text-workshop-600" />
          <h3 className="truncate text-lg font-black">{name}</h3>
          <span className="shrink-0 rounded-full bg-workshop-100 px-2 py-0.5 text-xs font-black text-workshop-700">{people.length}</span>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-2xl font-black tabular-nums text-workshop-700">{wholeNumber(total)}</p>
          <p className="text-[10px] font-bold uppercase tracking-wide text-steel-400">{t("pallets")}</p>
        </div>
      </div>
      {people.length === 0 ? (
        <p className={classNames("rounded-lg border border-dashed p-6 text-center text-sm font-bold", darkMode ? "border-white/10 text-steel-300" : "border-steel-200 text-steel-400")}>
          {t("No production yet")}
        </p>
      ) : (
        <div className={classNames("grid gap-2", dense ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3")}>
          {people.map((person, index) => (
            <button
              key={person.employee.id}
              type="button"
              onClick={() => onSelectEmployee(person.employee.id)}
              className={classNames(
                "flex items-center gap-2.5 rounded-lg border p-2 text-left transition-colors",
                darkMode ? "border-white/10 bg-white/[0.03] hover:bg-white/[0.08]" : "border-steel-100 bg-white hover:border-workshop-300"
              )}
            >
              <span className="w-5 shrink-0 text-center text-sm font-black tabular-nums text-steel-400">{index + 1}</span>
              <Avatar employee={person.employee} size="sm" />
              <span className="min-w-0 flex-1 truncate text-sm font-black">{person.employee.name}</span>
              <span className="shrink-0 text-lg font-black tabular-nums text-workshop-700">{wholeNumber(person.quantity)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Dashboard({
  settings,
  darkMode,
  countSheets,
  entries,
  locations,
  shifts,
  palletTypes,
  employees,
  onSelectEmployee
}: {
  settings: PayrollSettings;
  darkMode: boolean;
  countSheets: CountSheet[];
  entries: DailyEntry[];
  locations: Location[];
  shifts: Shift[];
  palletTypes: PalletType[];
  employees: Employee[];
  onSelectEmployee: (employeeId: string) => void;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const filteredEntries = useMemo(
    () => entries.filter((entry) => (!from || entry.date >= from) && (!to || entry.date <= to)),
    [entries, from, to]
  );
  const report = useMemo(
    () => buildReport(filteredEntries, palletTypes, employees, locations, settings),
    [filteredEntries, palletTypes, employees, locations, settings]
  );
  const countSheetStats = buildCountSheetStats(countSheets, entries, locations, shifts);

  function applyPreset(preset: number | "month" | "all") {
    if (preset === "all") {
      setFrom("");
      setTo("");
      return;
    }
    const end = new Date();
    const start = new Date();
    if (preset === "month") start.setDate(1);
    else start.setDate(end.getDate() - (preset - 1));
    setFrom(start.toISOString().slice(0, 10));
    setTo(end.toISOString().slice(0, 10));
  }

  const rangeLabel = from || to ? `${from || "start"} → ${to || "today"}` : "All time";

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-black">Dashboard</h2>
          <p className={classNames("text-sm", darkMode ? "text-steel-100" : "text-steel-500")}>Showing: {rangeLabel}</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Label title="Date range" icon={<CalendarDays size={16} />}>
            <CalendarField
              allowClear
              placeholder="All time"
              value={{ mode: from && to && from !== to ? "range" : "day", start: from, end: to || from }}
              onChange={(selection) => {
                if (selection.mode === "day") {
                  setFrom(selection.start);
                  setTo(selection.start);
                } else {
                  setFrom(selection.start);
                  setTo(selection.end);
                }
              }}
            />
          </Label>
          <div className="flex flex-wrap gap-1">
            <button type="button" className="touch-target rounded bg-steel-900 px-3 text-sm font-black text-white" onClick={() => applyPreset(7)}>7d</button>
            <button type="button" className="touch-target rounded bg-steel-900 px-3 text-sm font-black text-white" onClick={() => applyPreset(30)}>30d</button>
            <button type="button" className="touch-target rounded bg-steel-900 px-3 text-sm font-black text-white" onClick={() => applyPreset("month")}>Month</button>
            <button type="button" className="touch-target rounded bg-workshop-500 px-3 text-sm font-black text-white" onClick={() => applyPreset("all")}>All</button>
          </div>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Total Quantity" value={wholeNumber(report.summary.quantity)} />
        <Metric label="Piece Pay" value={currency(report.summary.piecePay)} />
        <Metric label="Make-up Pay" value={currency(report.summary.makeup)} />
        <Metric label="Total Payroll" value={currency(report.summary.totalPay)} />
        <Metric label="Min Wage" value={`${currency(settings.minimumWage)}/hr`} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="Count Sheets Today" value={wholeNumber(countSheetStats.uploadedToday)} />
        <Metric label="Pending Review" value={wholeNumber(countSheetStats.pending)} />
        <Metric label="Approved" value={wholeNumber(countSheetStats.approved)} />
        <Metric label="Rejected" value={wholeNumber(countSheetStats.rejected)} />
        <Metric label="Missing Count Sheets" value={wholeNumber(countSheetStats.missing.length)} />
      </div>
      {countSheetStats.missing.length > 0 && (
        <div className="rounded border border-steel-200 bg-steel-100 p-3 text-sm font-bold text-steel-900">
          Missing count sheets: {countSheetStats.missing.slice(0, 6).join(", ")}
          {countSheetStats.missing.length > 6 ? ` +${countSheetStats.missing.length - 6} more` : ""}
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className={classNames("h-80 rounded border p-3", darkMode ? "border-white/10 bg-white/[0.08]" : "border-steel-100 bg-white")}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={report.byPallet.slice(0, 10)}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" hide />
              <YAxis />
              <Tooltip />
              <Bar dataKey="quantity" fill="#2a6b40" name="Quantity" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <Leaderboard rows={report.byEmployee} onSelectEmployee={onSelectEmployee} />
      </div>
      <BreakdownTable title="Totals by Pallet Type" rows={report.byPallet} />
    </div>
  );
}

// Live check that the numbers reconcile across screens. It flags pallets that
// were entered but aren't in the Pallet Types list (no name, no rate → paid $0
// and hidden from the live tracker), and confirms the internal totals foot:
// per-employee sum == per-pallet-type sum == grand total.
function ReconciliationCard({ entries, report, palletTypes }: { entries: DailyEntry[]; report: ReturnType<typeof buildReport>; palletTypes: PalletType[] }) {
  const unknownList = useMemo(() => {
    const totals = new Map<string, number>();
    for (const entry of entries) {
      for (const line of entry.lines ?? []) {
        if (!findPalletType(palletTypes, line.palletTypeId)) {
          totals.set(line.palletTypeId, (totals.get(line.palletTypeId) ?? 0) + Number(line.quantity || 0));
        }
      }
    }
    return Array.from(totals, ([id, quantity]) => ({ id, quantity })).sort((a, b) => b.quantity - a.quantity);
  }, [entries, palletTypes]);

  const unknownQty = unknownList.reduce((sum, item) => sum + item.quantity, 0);
  const grandQty = report.summary.quantity;
  const byEmployeeQty = report.byEmployee.reduce((sum, row) => sum + row.quantity, 0);
  const byPalletQty = report.byPallet.reduce((sum, row) => (row.category === "QC Deductions" ? sum - row.quantity : sum + row.quantity), 0);
  const booksBalance = byEmployeeQty === grandQty && byPalletQty === grandQty;
  const trackerQty = grandQty - unknownQty;
  const ok = booksBalance && unknownList.length === 0;

  return (
    <div className={classNames("rounded border-2 p-4", ok ? "border-workshop-300 bg-workshop-50" : "border-amber-300 bg-amber-50")}>
      <div className="flex items-center gap-2">
        {ok ? <CheckCircle2 size={20} className="text-workshop-700" /> : <ShieldCheck size={20} className="text-amber-700" />}
        <h3 className="text-lg font-black text-steel-900">
          {ok ? "Numbers reconcile" : `${unknownList.length} unmatched pallet type${unknownList.length === 1 ? "" : "s"} — needs attention`}
        </h3>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-4">
        <div className="rounded border border-steel-100 bg-white p-3">
          <p className="text-xs font-bold uppercase tracking-wide text-steel-500">Total pallets (payroll)</p>
          <p className="text-2xl font-black text-steel-900">{wholeNumber(grandQty)}</p>
        </div>
        <div className="rounded border border-steel-100 bg-white p-3">
          <p className="text-xs font-bold uppercase tracking-wide text-steel-500">Shown on live tracker</p>
          <p className="text-2xl font-black text-steel-900">{wholeNumber(trackerQty)}</p>
        </div>
        <div className="rounded border border-steel-100 bg-white p-3">
          <p className="text-xs font-bold uppercase tracking-wide text-steel-500">Unmatched (no rate → $0)</p>
          <p className={classNames("text-2xl font-black", unknownQty > 0 ? "text-amber-700" : "text-steel-900")}>{wholeNumber(unknownQty)}</p>
        </div>
        <div className="rounded border border-steel-100 bg-white p-3">
          <p className="text-xs font-bold uppercase tracking-wide text-steel-500">Books balance</p>
          <p className={classNames("text-2xl font-black", booksBalance ? "text-workshop-700" : "text-red-700")}>{booksBalance ? "✓ Even" : "✗ Off"}</p>
        </div>
      </div>
      {unknownList.length > 0 ? (
        <div className="mt-3 text-sm text-steel-900">
          <p className="font-bold">
            These {wholeNumber(unknownQty)} pallets were entered but aren&apos;t in your Pallet Types list, so they pay $0 and don&apos;t show on the tracker. Match them in <strong>Admin → Pallet Types → Match Unknown Pallets</strong>:
          </p>
          <ul className="mt-2 grid gap-1">
            {unknownList.map((item) => (
              <li key={item.id} className="flex items-center justify-between rounded border border-amber-200 bg-white px-3 py-1.5">
                <span className="truncate font-mono text-xs font-black">{item.id}</span>
                <span className="shrink-0 text-sm font-black">{wholeNumber(item.quantity)} pallets</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-3 text-sm font-bold text-steel-600">
          Every pallet entered resolves to a real type with a rate. Payroll, the production grid, the entry screen, and the live tracker all count the same {wholeNumber(grandQty)} pallets for this selection.
        </p>
      )}
      {!booksBalance && (
        <p className="mt-2 text-sm font-black text-red-700">
          Internal totals don&apos;t foot (employee {wholeNumber(byEmployeeQty)} · pallet {wholeNumber(byPalletQty)} · grand {wholeNumber(grandQty)}). Send this to your developer — it shouldn&apos;t happen.
        </p>
      )}
    </div>
  );
}

function Payroll({
  entries,
  countSheets,
  employees,
  locations,
  shifts,
  palletTypes,
  settings,
  exportCsv,
  exportExcel,
  darkMode,
  onEditEntry,
  onViewEntry,
  onDeleteEntry,
  onSelectEmployee
}: {
  entries: DailyEntry[];
  countSheets: CountSheet[];
  employees: Employee[];
  locations: Location[];
  shifts: Shift[];
  palletTypes: PalletType[];
  settings: PayrollSettings;
  exportCsv: (entries: DailyEntry[]) => void;
  exportExcel: (entries: DailyEntry[]) => void;
  darkMode: boolean;
  onEditEntry: (entry: DailyEntry) => void;
  onViewEntry: (entry: DailyEntry) => void;
  onDeleteEntry: (id: string) => void;
  onSelectEmployee: (employeeId: string) => void;
}) {
  const [employeeFilter, setEmployeeFilter] = useState("all");
  const [locationFilter, setLocationFilter] = useState("all");
  const [shiftFilter, setShiftFilter] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      if (employeeFilter !== "all" && entry.employeeId !== employeeFilter) return false;
      if (locationFilter !== "all" && entry.locationId !== locationFilter) return false;
      if (shiftFilter !== "all" && entry.shift !== shiftFilter) return false;
      if (startDate && entry.date < startDate) return false;
      if (endDate && entry.date > endDate) return false;
      return true;
    });
  }, [employeeFilter, endDate, entries, locationFilter, shiftFilter, startDate]);

  const report = useMemo(() => buildReport(filteredEntries, palletTypes, employees, locations, settings), [employees, filteredEntries, locations, palletTypes, settings]);

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-black">Payroll Reports</h2>
          <p className={classNames("text-sm", darkMode ? "text-steel-100" : "text-steel-500")}>Detailed pallet breakdown, compliance pay, and export filters.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="touch-target flex items-center gap-2 rounded border border-steel-300 bg-white px-4 py-2 font-black text-steel-900" onClick={() => exportCsv(filteredEntries)}>
            <Download size={19} />
            Export CSV
          </button>
          <button type="button" className="touch-target flex items-center gap-2 rounded bg-[#1f7a4d] px-4 py-2 font-black text-white" onClick={() => exportExcel(filteredEntries)}>
            <Download size={19} />
            Export Excel
          </button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-5">
        <FilterSelect label="Employee" value={employeeFilter} onChange={setEmployeeFilter} options={[{ id: "all", name: "All Employees" }, ...employees.map((employee) => ({ id: employee.id, name: employee.name }))]} />
        <FilterSelect label="Location" value={locationFilter} onChange={setLocationFilter} options={[{ id: "all", name: "All Locations" }, ...locations.map((location) => ({ id: location.id, name: location.name }))]} />
        <FilterSelect label="Shift" value={shiftFilter} onChange={setShiftFilter} options={[{ id: "all", name: "All Shifts" }, ...shifts.map((shift) => ({ id: shift, name: shift }))]} />
        <Label title="Date" icon={<CalendarDays size={17} />}>
          <CalendarField
            allowClear
            value={{ mode: startDate && endDate && startDate !== endDate ? "range" : "day", start: startDate, end: endDate || startDate }}
            onChange={(selection) => {
              if (selection.mode === "day") {
                setStartDate(selection.start);
                setEndDate(selection.start);
              } else {
                setStartDate(selection.start);
                setEndDate(selection.end);
              }
            }}
          />
        </Label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Metric label="Quantity" value={wholeNumber(report.summary.quantity)} />
        <Metric label="Gross Piece Pay" value={currency(report.summary.piecePay)} />
        <Metric label="Make-up Pay" value={currency(report.summary.makeup)} />
        <Metric label="Daily OT" value={`${report.summary.dailyOvertime.toFixed(2)} hrs`} />
        <Metric label="Min Wage" value={`${currency(settings.minimumWage)}/hr`} />
        <Metric label="Total Pay" value={currency(report.summary.totalPay)} />
      </div>

      <ReconciliationCard entries={filteredEntries} report={report} palletTypes={palletTypes} />

      <EmployeeTable rows={report.byEmployee} onSelectEmployee={onSelectEmployee} />
      <BreakdownTable title="Quantities by Type" rows={report.byPallet} />
      <EntryHistory
        entries={filteredEntries}
        countSheets={countSheets}
        employees={employees}
        locations={locations}
        palletTypes={palletTypes}
        settings={settings}
        onEditEntry={onEditEntry}
        onViewEntry={onViewEntry}
        onDeleteEntry={onDeleteEntry}
        onSelectEmployee={onSelectEmployee}
      />
    </div>
  );
}

function WeekControls({ selectedWeek, onWeekChange }: { selectedWeek: string; onWeekChange: (week: string) => void }) {
  return (
    <div className="grid grid-cols-[44px_1fr_44px_auto] gap-2">
      <button type="button" aria-label="Previous week" className="touch-target rounded bg-steel-900 font-black text-white" onClick={() => onWeekChange(addDays(selectedWeek, -7))}>
        ‹
      </button>
      <CalendarField
        lockWeek
        value={{ mode: "week", start: selectedWeek, end: addDays(selectedWeek, 6) }}
        onChange={(selection) => onWeekChange(getWeekKey(selection.start))}
      />
      <button type="button" aria-label="Next week" className="touch-target rounded bg-steel-900 font-black text-white" onClick={() => onWeekChange(addDays(selectedWeek, 7))}>
        ›
      </button>
      <button type="button" className="touch-target rounded bg-safety-400 px-3 font-black text-steel-900" onClick={() => onWeekChange(getWeekKey(today))}>
        Current
      </button>
    </div>
  );
}

function entryToForm(entry: DailyEntry, palletTypes: PalletType[]): EntryForm {
  const entryLines = new Map<string, number>();
  const entryParts = new Map<string, number[]>();
  for (const line of entry.lines) {
    const resolvedId = getResolvedPalletTypeId(palletTypes, line.palletTypeId);
    entryLines.set(resolvedId, (entryLines.get(resolvedId) ?? 0) + line.quantity);
    if (Array.isArray(line.parts) && line.parts.length) {
      entryParts.set(resolvedId, [...(entryParts.get(resolvedId) ?? []), ...line.parts]);
    }
  }
  const lineIds = new Set([...palletTypes.map((pallet) => pallet.id), ...entryLines.keys()]);

  return {
    date: entry.date,
    employeeId: entry.employeeId,
    locationId: entry.locationId,
    shift: entry.shift,
    lines: Array.from(lineIds).map((palletTypeId) => {
      const parts = entryParts.get(palletTypeId);
      return {
        palletTypeId,
        quantity: entryLines.get(palletTypeId) ?? 0,
        ...(parts && parts.length > 1 ? { parts } : {})
      };
    }),
    phases: normalizePhases(entry.phases),
    clockIn: entry.clockIn,
    clockOut: entry.clockOut,
    manualHours: entry.manualHours,
    breakProfile: entry.breakProfile,
    notes: entry.notes ?? ""
  };
}

function getWeekDays(weekStart: string) {
  return Array.from({ length: 6 }, (_value, index) => addDays(weekStart, index));
}

function addDays(dateValue: string, days: number) {
  const date = new Date(`${dateValue}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatDayHeader(dateValue: string) {
  const date = new Date(`${dateValue}T12:00:00`);
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "numeric", day: "numeric" }).format(date);
}

// A saved entry's date shown in full — month name, day, and year (e.g.
// "July 22, 2026") — instead of the raw YYYY-MM-DD. Falls back to the raw
// value if it can't be parsed.
function formatEntryDate(dateValue: string) {
  const date = new Date(`${dateValue}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateValue;
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(date);
}

function ProductionGrid({
  entries,
  countSheets,
  employees,
  locations,
  palletTypes,
  settings,
  selectedWeek,
  onWeekChange,
  onSelectEmployee,
  onEditEntry,
  onViewEntry,
  onDeleteEntry,
  exportCsv,
  exportExcel
}: {
  entries: DailyEntry[];
  countSheets: CountSheet[];
  employees: Employee[];
  locations: Location[];
  palletTypes: PalletType[];
  settings: PayrollSettings;
  selectedWeek: string;
  onWeekChange: (week: string) => void;
  onSelectEmployee: (employeeId: string) => void;
  onEditEntry: (entry: DailyEntry) => void;
  onViewEntry: (entry: DailyEntry) => void;
  onDeleteEntry: (id: string) => void;
  // Export the currently-shown week's entries as CSV / multi-sheet Excel.
  exportCsv: (entries: DailyEntry[]) => void;
  exportExcel: (entries: DailyEntry[]) => void;
}) {
  const weekDays = getWeekDays(selectedWeek);
  const weekEntries = entries.filter((entry) => weekDays.includes(entry.date));
  const activePallets = palletTypes.filter((pallet) => pallet.active || weekEntries.some((entry) => entry.lines.some((line) => line.palletTypeId === pallet.id)));
  const weekReport = buildReport(weekEntries, palletTypes, employees, locations, settings);

  const weekStart = weekDays[0];
  const weekEnd = weekDays[weekDays.length - 1];
  const [photoFrom, setPhotoFrom] = useState(weekStart);
  const [photoTo, setPhotoTo] = useState(weekEnd);
  useEffect(() => {
    setPhotoFrom(weekStart);
    setPhotoTo(weekEnd);
  }, [weekStart, weekEnd]);

  const photoLocationName = (id: string) => locations.find((location) => location.id === id)?.name ?? id;
  const rangeSheets = countSheets.filter((sheet) => (!photoFrom || sheet.date >= photoFrom) && (!photoTo || sheet.date <= photoTo));
  const rangePhotos = rangeSheets.flatMap((sheet) => sheet.photos.map((photo) => ({ photo, sheet })));

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-black">Production Grid</h2>
          <p className="text-sm text-steel-500">Weekly spreadsheet view by repairer, pallet type, day, and dollars.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Export the week currently shown. Disabled when the week is empty. */}
          <button
            type="button"
            disabled={weekEntries.length === 0}
            className="touch-target flex items-center gap-2 rounded border border-steel-300 bg-white px-4 py-2 font-black text-steel-900 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => exportCsv(weekEntries)}
          >
            <Download size={19} />
            Export CSV
          </button>
          <button
            type="button"
            disabled={weekEntries.length === 0}
            className="touch-target flex items-center gap-2 rounded bg-[#1f7a4d] px-4 py-2 font-black text-white disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => exportExcel(weekEntries)}
          >
            <Download size={19} />
            Export Excel
          </button>
          <WeekControls selectedWeek={selectedWeek} onWeekChange={onWeekChange} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="Week Quantity" value={wholeNumber(weekReport.summary.quantity)} />
        <Metric label="Piece Pay" value={currency(weekReport.summary.piecePay)} />
        <Metric label="Make-up Pay" value={currency(weekReport.summary.makeup)} />
        <Metric label="Overtime" value={`${weekReport.summary.dailyOvertime.toFixed(2)} hrs`} />
        <Metric label="Weekly Total" value={currency(weekReport.summary.totalPay)} />
      </div>

      {employees.filter((employee) => employee.active || weekEntries.some((entry) => entry.employeeId === employee.id)).map((employee) => {
        const employeeEntries = weekEntries.filter((entry) => entry.employeeId === employee.id);
        const employeeReport = buildReport(employeeEntries, palletTypes, employees, locations, settings);
        if (employeeEntries.length === 0) {
          return null;
        }

        return (
          <div key={employee.id} className="overflow-hidden rounded border border-steel-100 bg-white text-steel-900">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-steel-100 bg-steel-50 p-3">
              <button type="button" className="flex items-center gap-3 text-left" onClick={() => onSelectEmployee(employee.id)}>
                <Avatar employee={employee} size="lg" />
                <div>
                  <h3 className="text-xl font-black">{employee.name}</h3>
                  <p className="text-sm text-steel-500">{locations.find((location) => location.id === employee.locationId)?.name ?? employee.locationId} · {employee.shift}</p>
                </div>
              </button>
              <div className="grid grid-cols-3 gap-2 text-center text-sm">
                <strong className="rounded bg-safety-400 px-3 py-2">{wholeNumber(employeeReport.summary.quantity)} qty</strong>
                <strong className="rounded bg-safety-400 px-3 py-2">{currency(employeeReport.summary.piecePay)}</strong>
                <strong className="rounded bg-safety-400 px-3 py-2">{currency(employeeReport.summary.totalPay)} total</strong>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1120px] text-left text-xs">
                <thead>
                  <tr className="bg-steel-900 text-white">
                    <th className="p-2">Pallet Type</th>
                    {weekDays.map((day) => (
                      <th key={day} className="p-2 text-center">{formatDayHeader(day)}</th>
                    ))}
                    <th className="bg-safety-400 p-2 text-center text-steel-900">Weekly Qty</th>
                    <th className="bg-safety-400 p-2 text-center text-steel-900">Weekly $</th>
                  </tr>
                </thead>
                <tbody>
                  {activePallets.map((pallet) => {
                    const dayCells = weekDays.map((day) => {
                      const quantity = employeeEntries
                        .filter((entry) => entry.date === day)
                        .reduce((total, entry) => total + entry.lines.reduce((lineTotal, line) => lineTotal + (getResolvedPalletTypeId(palletTypes, line.palletTypeId) === pallet.id ? line.quantity : 0), 0), 0);
                      return { day, quantity, amount: quantity * pallet.rate };
                    });
                    const weeklyQty = dayCells.reduce((total, cell) => total + cell.quantity, 0);
                    const weeklyAmount = dayCells.reduce((total, cell) => total + cell.amount, 0);

                    return (
                      <tr key={pallet.id} className="border-t border-steel-100 even:bg-steel-50">
                        <td className="p-2">
                          <strong className="block">{pallet.code}</strong>
                          <span className="text-steel-500">{pallet.description}</span>
                        </td>
                        {dayCells.map((cell) => (
                          <td key={cell.day} className="p-2 text-center">
                            <span className="block font-black">{wholeNumber(cell.quantity)}</span>
                            <span className={classNames("block", cell.amount < 0 ? "text-red-700" : "text-steel-500")}>{currency(cell.amount)}</span>
                          </td>
                        ))}
                        <td className="bg-workshop-100 p-2 text-center font-black">{wholeNumber(weeklyQty)}</td>
                        <td className="bg-workshop-100 p-2 text-center font-black">{currency(weeklyAmount)}</td>
                      </tr>
                    );
                  })}
                  <tr className="border-t-2 border-steel-900 bg-workshop-100 font-black">
                    <td className="p-2">Daily Totals</td>
                    {weekDays.map((day) => {
                      const dayEntries = employeeEntries.filter((entry) => entry.date === day);
                      const dayReport = buildReport(dayEntries, palletTypes, employees, locations, settings);
                      return (
                        <td key={day} className="p-2 text-center">
                          <span className="block">{wholeNumber(dayReport.summary.quantity)}</span>
                          <span className="block">{currency(dayReport.summary.totalPay)}</span>
                        </td>
                      );
                    })}
                    <td className="p-2 text-center">{wholeNumber(employeeReport.summary.quantity)}</td>
                    <td className="p-2 text-center">{currency(employeeReport.summary.totalPay)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="border-t border-steel-100 p-3">
              <EntryHistory
                compact
                entries={employeeEntries}
                countSheets={countSheets}
                employees={employees}
                locations={locations}
                palletTypes={palletTypes}
                settings={settings}
                onEditEntry={onEditEntry}
                onViewEntry={onViewEntry}
                onDeleteEntry={onDeleteEntry}
                onSelectEmployee={onSelectEmployee}
              />
            </div>
          </div>
        );
      })}

      {weekEntries.length === 0 && (
        <div className="rounded border border-steel-100 bg-white p-5 text-center font-bold text-steel-500">
          No production entries found for this week.
        </div>
      )}

      <div className="rounded border border-steel-100 bg-white p-4 text-steel-900">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-lg font-black">Count Sheet Photos</h3>
            <p className="text-sm font-bold text-steel-500">{rangeSheets.length} count sheet{rangeSheets.length === 1 ? "" : "s"} · {rangePhotos.length} photo{rangePhotos.length === 1 ? "" : "s"} in range</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Label title="Date" icon={<CalendarDays size={16} />}>
              <CalendarField
                allowClear
                align="right"
                value={{ mode: photoFrom && photoTo && photoFrom !== photoTo ? "range" : "day", start: photoFrom, end: photoTo || photoFrom }}
                onChange={(selection) => {
                  if (selection.mode === "day") {
                    setPhotoFrom(selection.start);
                    setPhotoTo(selection.start);
                  } else {
                    setPhotoFrom(selection.start);
                    setPhotoTo(selection.end);
                  }
                }}
              />
            </Label>
          </div>
        </div>
        {rangePhotos.length === 0 ? (
          <p className="mt-3 text-sm font-bold text-steel-500">No count sheet photos in this date range.</p>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-6">
            {rangePhotos.map(({ photo, sheet }) => (
              <a key={photo.id} href={photo.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded border border-steel-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.url} alt={photo.fileName} className="h-28 w-full bg-steel-50 object-cover" />
                <span className="block truncate bg-steel-50 px-2 py-1 text-xs font-bold">{photoLocationName(sheet.locationId)} · {sheet.shift} · {sheet.date}</span>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EntryHistory({
  entries,
  countSheets = [],
  employees,
  locations,
  palletTypes,
  settings,
  compact,
  onEditEntry,
  onViewEntry,
  onDeleteEntry,
  onSelectEmployee
}: {
  entries: DailyEntry[];
  countSheets?: CountSheet[];
  employees: Employee[];
  locations: Location[];
  palletTypes: PalletType[];
  settings: PayrollSettings;
  compact?: boolean;
  onEditEntry: (entry: DailyEntry) => void;
  onViewEntry: (entry: DailyEntry) => void;
  onDeleteEntry: (id: string) => void;
  onSelectEmployee: (employeeId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<"date" | "employee" | "location" | "shift">("date");
  const [viewerSheets, setViewerSheets] = useState<CountSheet[]>([]);
  const [viewerPhotoIndex, setViewerPhotoIndex] = useState(0);
  const filtered = entries
    .filter((entry) => {
      const employee = employees.find((item) => item.id === entry.employeeId)?.name ?? "";
      const location = locations.find((item) => item.id === entry.locationId)?.name ?? "";
      const query = search.toLowerCase();
      return `${entry.date} ${employee} ${location} ${entry.shift} ${entry.notes ?? ""}`.toLowerCase().includes(query);
    })
    .sort((a, b) => {
      if (sortKey === "employee") return (employees.find((item) => item.id === a.employeeId)?.name ?? "").localeCompare(employees.find((item) => item.id === b.employeeId)?.name ?? "");
      if (sortKey === "location") return (locations.find((item) => item.id === a.locationId)?.name ?? "").localeCompare(locations.find((item) => item.id === b.locationId)?.name ?? "");
      if (sortKey === "shift") return a.shift.localeCompare(b.shift);
      // Dates in chronological order — earliest at the top (Mon→Fri, top to
      // bottom) — with same-day entries ordered by when they were entered.
      return a.date.localeCompare(b.date) || (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
    });

  return (
    <div className="grid gap-3">
      {!compact && (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-xl font-black">Entry History</h3>
            <p className="text-sm text-steel-500">Open, edit, review, or delete saved production entries.</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-[220px_180px]">
            <Label title="Search" icon={<Search size={17} />}>
              <input className="field" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search entries" />
            </Label>
            <Label title="Sort" icon={<Filter size={17} />}>
              <select className="field" value={sortKey} onChange={(event) => setSortKey(event.target.value as "date" | "employee" | "location" | "shift")}>
                <option value="date">Date</option>
                <option value="employee">Employee</option>
                <option value="location">Location</option>
                <option value="shift">Shift</option>
              </select>
            </Label>
          </div>
        </div>
      )}
      <div className="overflow-hidden rounded border border-steel-100 bg-white text-steel-900">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="bg-steel-900 text-white">
              <tr>
                <th className="p-3">Date</th>
                <th className="p-3">Repairer</th>
                <th className="p-3">Location</th>
                <th className="p-3">Shift</th>
                <th className="p-3">Qty</th>
                <th className="p-3">Piece Pay</th>
                <th className="p-3">Make-up</th>
                <th className="p-3">Total</th>
                <th className="p-3">Count Sheets</th>
                <th className="p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry) => {
                const employee = employees.find((item) => item.id === entry.employeeId);
                const calc = calculateEntry(entry, palletTypes, settings);
                const linkedSheets = getLinkedCountSheets(countSheets, entry);
                return (
                  <tr key={entry.id} className="border-t border-steel-100 even:bg-steel-50">
                    <td className="p-3 font-bold">
                      <span className="block">{formatEntryDate(entry.date)}</span>
                      {entry.updatedAt && <span className="block text-xs font-bold text-steel-500">Modified {new Date(entry.updatedAt).toLocaleString()}</span>}
                    </td>
                    <td className="p-3">
                      <button type="button" className="flex items-center gap-2 font-black text-workshop-700" onClick={() => onSelectEmployee(entry.employeeId)}>
                        <Avatar employee={employee} />
                        {employee?.name ?? entry.employeeId}
                      </button>
                    </td>
                    <td className="p-3">{locations.find((item) => item.id === entry.locationId)?.name ?? entry.locationId}</td>
                    <td className="p-3">{entry.shift}</td>
                    <td className="p-3">{wholeNumber(calc.quantity)}</td>
                    <td className="p-3">{currency(calc.pieceEarnings)}</td>
                    <td className="p-3">{currency(calc.additionalOwed)}</td>
                    <td className="p-3 font-black">{currency(calc.totalPay)}</td>
                    <td className="p-3">
                      {linkedSheets.length > 0 ? (
                        (() => {
                          const linkedPhotos = linkedSheets.flatMap((sheet) => sheet.photos);
                          return (
                            <button
                              type="button"
                              className="flex items-center gap-2"
                              onClick={() => {
                                setViewerSheets(linkedSheets);
                                setViewerPhotoIndex(0);
                              }}
                            >
                              {linkedPhotos[0] ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={linkedPhotos[0].url} alt="Count sheet" className="h-12 w-12 shrink-0 rounded border border-steel-200 object-cover" />
                              ) : (
                                <Camera size={18} className="text-workshop-700" />
                              )}
                              <span className="text-xs font-black text-workshop-700">
                                {linkedPhotos.length || linkedSheets.length} photo{(linkedPhotos.length || linkedSheets.length) === 1 ? "" : "s"}
                              </span>
                            </button>
                          );
                        })()
                      ) : (
                        <span className="rounded bg-steel-200 px-2 py-1 text-xs font-black text-steel-700">Missing</span>
                      )}
                    </td>
                    <td className="p-3">
                      <div className="flex gap-2">
                        <IconButton label={`View entry ${entry.date}`} icon={<Eye size={18} />} onClick={() => onViewEntry(entry)} />
                        <IconButton label={`Edit entry ${entry.date}`} icon={<Edit2 size={18} />} onClick={() => onEditEntry(entry)} />
                        <IconButton label={`Delete entry ${entry.date}`} icon={<Trash2 size={18} />} danger onClick={() => onDeleteEntry(entry.id)} />
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td className="p-4 text-center font-bold text-steel-500" colSpan={10}>No saved entries found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {viewerSheets.length > 0 && (
        <CountSheetViewer
          sheets={viewerSheets}
          photoIndex={viewerPhotoIndex}
          setPhotoIndex={setViewerPhotoIndex}
          locations={locations}
          linkedEntries={entries.filter((entry) => viewerSheets.some((sheet) => entry.date === sheet.date && entry.locationId === sheet.locationId && entry.shift === sheet.shift))}
          roleMode="counter"
          onClose={() => setViewerSheets([])}
          onUpdate={() => undefined}
        />
      )}
    </div>
  );
}

function Settings({
  darkMode,
  status,
  activeTab,
  setActiveTab,
  palletTypes,
  entries,
  employees,
  locations,
  shifts,
  settings,
  onCreatePallet,
  onUpdatePallet,
  onDeletePallet,
  onRemapPallet,
  onCreateEmployee,
  onUpdateEmployee,
  onDeleteEmployee,
  onLocationsChange,
  onShiftsChange,
  onSettingsChange
}: {
  darkMode: boolean;
  status: string;
  activeTab: AdminTab;
  setActiveTab: (tab: AdminTab) => void;
  palletTypes: PalletType[];
  entries: DailyEntry[];
  employees: Employee[];
  locations: Location[];
  shifts: Shift[];
  settings: PayrollSettings;
  onCreatePallet: (palletType: Omit<PalletType, "id">) => void | Promise<void>;
  onUpdatePallet: (id: string, patch: Partial<PalletType>) => void | Promise<void>;
  onDeletePallet: (id: string) => void | Promise<void>;
  onRemapPallet: (fromId: string, toId: string) => Promise<number>;
  onCreateEmployee: (employee: Omit<Employee, "id">) => void | Promise<void>;
  onUpdateEmployee: (id: string, patch: Partial<Employee>) => void | Promise<void>;
  onDeleteEmployee: (id: string) => void | Promise<void>;
  onLocationsChange: (locations: Location[]) => void;
  onShiftsChange: (shifts: Shift[]) => void;
  onSettingsChange: (settings: PayrollSettings) => void;
}) {
  return (
    <div className="grid gap-5">
      <div>
        <h2 className="text-2xl font-black">Admin Management</h2>
        <p className={classNames("text-sm", darkMode ? "text-steel-100" : "text-steel-500")}>{status}</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-4">
        <AdminTabButton label="Settings" active={activeTab === "settings"} onClick={() => setActiveTab("settings")} />
        <AdminTabButton label="Pallet Types" active={activeTab === "pallets"} onClick={() => setActiveTab("pallets")} />
        <AdminTabButton label="Repairers" active={activeTab === "employees"} onClick={() => setActiveTab("employees")} />
        <AdminTabButton label="Locations / Shifts" active={activeTab === "locations"} onClick={() => setActiveTab("locations")} />
      </div>
      {activeTab === "settings" && <PayrollSettingsAdmin settings={settings} onSettingsChange={onSettingsChange} />}
      {activeTab === "pallets" && <PalletAdmin palletTypes={palletTypes} entries={entries} onCreate={onCreatePallet} onUpdate={onUpdatePallet} onDelete={onDeletePallet} onRemapPallet={onRemapPallet} />}
      {activeTab === "employees" && <EmployeeAdmin employees={employees} locations={locations} shifts={shifts} onCreate={onCreateEmployee} onUpdate={onUpdateEmployee} onDelete={onDeleteEmployee} />}
      {activeTab === "locations" && <LocationShiftAdmin locations={locations} shifts={shifts} onLocationsChange={onLocationsChange} onShiftsChange={onShiftsChange} />}
    </div>
  );
}

function PayrollSettingsAdmin({ settings, onSettingsChange }: { settings: PayrollSettings; onSettingsChange: (settings: PayrollSettings) => void }) {
  const [minimumWageInput, setMinimumWageInput] = useState(settings.minimumWage.toFixed(2));
  const [dailyGoalInput, setDailyGoalInput] = useState(String(settings.dailyProductionGoal));
  const [message, setMessage] = useState(`Current California Minimum Wage: ${currency(settings.minimumWage)}/hr`);
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setMinimumWageInput(settings.minimumWage.toFixed(2));
    setDailyGoalInput(String(settings.dailyProductionGoal));
  }, [settings.dailyProductionGoal, settings.minimumWage]);

  function saveSettings() {
    const parsed = Number(minimumWageInput);
    const parsedGoal = Number(dailyGoalInput);

    if (!minimumWageInput.trim() || Number.isNaN(parsed)) {
      setError("Enter a valid numeric dollar amount.");
      return;
    }

    if (parsed < 0) {
      setError("Minimum wage cannot be negative.");
      return;
    }

    if (!dailyGoalInput.trim() || Number.isNaN(parsedGoal) || parsedGoal < 0) {
      setError("Daily production goal must be a non-negative number.");
      return;
    }

    setIsSaving(true);
    setError("");
    const nextSettings = {
      ...settings,
      minimumWage: Number(parsed.toFixed(2)),
      dailyProductionGoal: Math.round(parsedGoal)
    };
    onSettingsChange(nextSettings);
    setMessage(`Settings saved. Minimum wage ${currency(nextSettings.minimumWage)}/hr; daily goal ${wholeNumber(nextSettings.dailyProductionGoal)} pallets.`);
    window.setTimeout(() => setIsSaving(false), 150);
  }

  return (
    <div className="grid gap-4">
      <SaveNotice message={message} error={error} />
      <div className="rounded border border-steel-100 bg-white p-4 text-steel-900">
        <div className="grid gap-3 md:grid-cols-[1fr_220px_220px_auto] md:items-end">
          <div>
            <h3 className="text-xl font-black">Payroll Compliance</h3>
            <p className="mt-1 text-sm text-steel-500">This value is used for make-up pay, compliance pay, payroll reports, dashboard totals, and CSV exports.</p>
          </div>
          <Label title="California Minimum Wage" icon={<FileSpreadsheet size={17} />}>
            <input
              className="field"
              inputMode="decimal"
              min="0"
              step="0.01"
              type="number"
              value={minimumWageInput}
              onChange={(event) => {
                setMinimumWageInput(event.target.value);
                setError("");
              }}
            />
          </Label>
          <Label title="Daily Production Goal" icon={<BarChart3 size={17} />}>
            <input
              className="field"
              inputMode="numeric"
              min="0"
              step="1"
              type="number"
              value={dailyGoalInput}
              onChange={(event) => {
                setDailyGoalInput(event.target.value);
                setError("");
              }}
            />
          </Label>
          <button type="button" disabled={isSaving} className="touch-target flex items-center justify-center gap-2 rounded bg-workshop-500 px-4 py-2 font-black text-white disabled:bg-steel-500" onClick={saveSettings}>
            <Save size={19} />
            {isSaving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PalletAdmin({
  palletTypes,
  entries,
  onCreate,
  onUpdate,
  onDelete,
  onRemapPallet
}: {
  palletTypes: PalletType[];
  entries: DailyEntry[];
  onCreate: (palletType: Omit<PalletType, "id">) => void | Promise<void>;
  onUpdate: (id: string, patch: Partial<PalletType>) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
  onRemapPallet: (fromId: string, toId: string) => Promise<number>;
}) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<"All" | PalletCategory>("All");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Omit<PalletType, "id">>(emptyPallet);
  const [editDraft, setEditDraft] = useState<PalletType | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("Ready.");
  const [error, setError] = useState("");

  // Pallet ids referenced by entries that don't resolve to any pallet type in
  // the list (orphaned "custom:…" leftovers). Each carries its total quantity so
  // the admin can see how much production is stuck on it.
  const unknownPallets = useMemo(() => {
    const totals = new Map<string, number>();
    for (const entry of entries) {
      for (const line of entry.lines ?? []) {
        if (!findPalletType(palletTypes, line.palletTypeId)) {
          totals.set(line.palletTypeId, (totals.get(line.palletTypeId) ?? 0) + Number(line.quantity || 0));
        }
      }
    }
    return Array.from(totals, ([id, quantity]) => ({ id, quantity })).sort((a, b) => b.quantity - a.quantity);
  }, [entries, palletTypes]);
  const [remapTargets, setRemapTargets] = useState<Record<string, string>>({});
  const [remapBusy, setRemapBusy] = useState<string | null>(null);

  async function applyRemap(fromId: string) {
    const toId = remapTargets[fromId];
    if (!toId) return;
    setRemapBusy(fromId);
    try {
      const count = await onRemapPallet(fromId, toId);
      const target = palletTypes.find((pallet) => pallet.id === toId);
      setMessage(`Matched ${fromId} → ${target?.code ?? toId} across ${count} entr${count === 1 ? "y" : "ies"}.`);
    } finally {
      setRemapBusy(null);
    }
  }

  const filtered = palletTypes.filter((pallet) => {
    const query = search.toLowerCase();
    return (categoryFilter === "All" || pallet.category === categoryFilter) && `${pallet.code} ${pallet.description} ${pallet.category}`.toLowerCase().includes(query);
  });

  function reset() {
    setDraft(emptyPallet);
    setEditingId(null);
  }

  function edit(pallet: PalletType) {
    setEditingId(pallet.id);
    setEditDraft({ ...pallet });
    setMessage(`Editing ${pallet.code}.`);
    setError("");
  }

  async function save() {
    const clean = { ...draft, code: draft.code.trim(), description: draft.description.trim(), rate: Number(draft.rate) };
    if (!clean.code) return;
    setIsSaving(true);
    setError("");
    try {
      await Promise.resolve(onCreate(clean));
      setMessage(`${clean.code} added.`);
      reset();
    } catch {
      setError("Could not save pallet type. Try again.");
    } finally {
      setIsSaving(false);
    }
  }

  async function saveEdit() {
    if (!editDraft) return;
    const clean = {
      ...editDraft,
      code: editDraft.code.trim(),
      description: editDraft.description.trim(),
      rate: Number(editDraft.rate)
    };
    if (!clean.code) {
      setError("Pallet name is required.");
      return;
    }

    setIsSaving(true);
    setError("");
    try {
      await Promise.resolve(onUpdate(clean.id, clean));
      setMessage(`${clean.code} saved.`);
      setEditDraft(null);
      setEditingId(null);
    } catch {
      setError("Could not save pallet changes. Try again.");
    } finally {
      setIsSaving(false);
    }
  }

  async function deletePallet(pallet: PalletType) {
    if (!window.confirm(`Delete ${pallet.code} - ${pallet.description}?`)) {
      return;
    }

    setIsSaving(true);
    setError("");
    try {
      await Promise.resolve(onDelete(pallet.id));
      setMessage(`${pallet.code} deleted.`);
    } catch {
      setError("Could not delete pallet type. Try again.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="grid gap-4">
      <SaveNotice message={message} error={error} />

      {unknownPallets.length > 0 && (
        <div className="rounded border-2 border-amber-300 bg-amber-50 p-4 text-steel-900">
          <h3 className="flex items-center gap-2 text-lg font-black">
            <ShieldCheck size={18} /> Match Unknown Pallets ({unknownPallets.length})
          </h3>
          <p className="mt-1 text-sm font-bold text-steel-600">
            These pallets were entered in production but aren&apos;t in your list, so they have no name or rate and pay $0. Pick a pallet type for each — the production is moved onto it and starts counting in payroll everywhere. Add the pallet under &quot;Custom&quot; below first if it doesn&apos;t exist yet.
          </p>
          <div className="mt-3 grid gap-2">
            {unknownPallets.map((unknown) => (
              <div key={unknown.id} className="grid items-center gap-2 rounded border border-amber-200 bg-white p-2 sm:grid-cols-[1fr_auto_1fr_auto]">
                <div className="min-w-0">
                  <span className="block truncate font-mono text-sm font-black">{unknown.id}</span>
                  <span className="text-xs font-bold text-steel-500">{wholeNumber(unknown.quantity)} pallets entered</span>
                </div>
                <span className="hidden text-steel-400 sm:inline">→</span>
                <select
                  className="field"
                  value={remapTargets[unknown.id] ?? ""}
                  onChange={(event) => setRemapTargets((current) => ({ ...current, [unknown.id]: event.target.value }))}
                >
                  <option value="">Choose pallet type…</option>
                  {palletTypes.filter((pallet) => pallet.active).map((pallet) => (
                    <option key={pallet.id} value={pallet.id}>{`${pallet.code} ${pallet.description}`.trim()} (${pallet.rate})</option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!remapTargets[unknown.id] || remapBusy === unknown.id}
                  className="touch-target rounded bg-[#1f7a4d] px-4 py-2 font-black text-white disabled:bg-steel-400"
                  onClick={() => applyRemap(unknown.id)}
                >
                  {remapBusy === unknown.id ? "Matching…" : "Match"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-[1fr_1fr_160px_auto]">
        <Label title="Pallet Name" icon={<Factory size={17} />}>
          <input className="field" value={draft.code} onChange={(event) => setDraft((current) => ({ ...current, code: event.target.value }))} placeholder="1 STACKER" />
        </Label>
        <Label title="Description" icon={<FileSpreadsheet size={17} />}>
          <input className="field" value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} placeholder="BLOCK" />
        </Label>
        <Label title="Rate" icon={<FileSpreadsheet size={17} />}>
          <input className="field" type="number" step="0.01" value={draft.rate} onChange={(event) => setDraft((current) => ({ ...current, rate: Number(event.target.value) }))} />
        </Label>
        <label className="flex items-end gap-2 pb-1 font-black">
          <input className="h-5 w-5" type="checkbox" checked={draft.active} onChange={(event) => setDraft((current) => ({ ...current, active: event.target.checked }))} />
          Active
        </label>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <Label title="Category" icon={<Filter size={17} />}>
          <select className="field" value={draft.category} onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value as PalletCategory }))}>
            {palletCategories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </Label>
        <Label title="Photo URL" icon={<Camera size={17} />}>
          <input className="field" value={draft.photoUrl ?? ""} onChange={(event) => setDraft((current) => ({ ...current, photoUrl: event.target.value }))} placeholder="Future pallet photo" />
        </Label>
        <Label title="Customer Rate" icon={<Building2 size={17} />}>
          <input className="field" value={draft.customerRateNote ?? ""} onChange={(event) => setDraft((current) => ({ ...current, customerRateNote: event.target.value }))} placeholder="Future override" />
        </Label>
        <Label title="Location Rate" icon={<MapPin size={17} />}>
          <input className="field" value={draft.locationRateNote ?? ""} onChange={(event) => setDraft((current) => ({ ...current, locationRateNote: event.target.value }))} placeholder="Future override" />
        </Label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={isSaving} className="touch-target flex items-center gap-2 rounded bg-workshop-500 px-4 py-2 font-black text-white disabled:cursor-not-allowed disabled:bg-steel-500" onClick={save}>
          <Check size={19} />
          {isSaving ? "Saving..." : "Add Pallet Type"}
        </button>
      </div>
      <div className="grid gap-3 md:grid-cols-[1fr_220px]">
        <Label title="Search" icon={<Search size={17} />}>
          <input className="field" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search pallet rows" />
        </Label>
        <Label title="Category" icon={<Filter size={17} />}>
          <select className="field" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value as "All" | PalletCategory)}>
            <option value="All">All Categories</option>
            {palletCategories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </Label>
      </div>
      <div className="overflow-hidden rounded border border-steel-100 bg-white text-steel-900">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-steel-900 text-white">
              <tr>
                <th className="p-3">Category</th>
                <th className="p-3">Description</th>
                <th className="p-3">Rate</th>
                <th className="p-3">Status</th>
                <th className="p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((pallet) => (
                <tr key={pallet.id} className="border-t border-steel-100 even:bg-steel-50">
                  <td className="p-3 font-black">{pallet.category}</td>
                  <td className="p-3">
                    <strong className="block">{pallet.code}</strong>
                    <span className="text-steel-500">{pallet.description}</span>
                  </td>
                  <td className={classNames("p-3 font-black", pallet.rate < 0 ? "text-red-700" : "text-workshop-700")}>{currency(pallet.rate)}</td>
                  <td className="p-3">
                    <button type="button" className={classNames("rounded px-3 py-1 text-xs font-black", pallet.active ? "bg-workshop-500 text-white" : "bg-steel-100 text-steel-700")} onClick={() => onUpdate(pallet.id, { active: !pallet.active })}>
                      {pallet.active ? "Active" : "Inactive"}
                    </button>
                  </td>
                  <td className="p-3">
                    <div className="flex gap-2">
                      <IconButton label={`Edit ${pallet.code}`} icon={<Edit2 size={18} />} onClick={() => edit(pallet)} />
                      <IconButton label={`Delete ${pallet.code}`} icon={<Trash2 size={18} />} danger onClick={() => deletePallet(pallet)} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {editDraft && (
        <Modal title={`Edit ${editDraft.code}`} onClose={() => !isSaving && setEditDraft(null)}>
          <div className="grid gap-3">
            <Label title="Category" icon={<Filter size={17} />}>
              <select className="field" value={editDraft.category} onChange={(event) => setEditDraft((current) => current ? { ...current, category: event.target.value as PalletCategory } : current)}>
                {palletCategories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </Label>
            <Label title="Description" icon={<FileSpreadsheet size={17} />}>
              <input className="field" value={editDraft.description} onChange={(event) => setEditDraft((current) => current ? { ...current, description: event.target.value } : current)} />
            </Label>
            <Label title="Rate" icon={<FileSpreadsheet size={17} />}>
              <input className="field" type="number" step="0.01" value={editDraft.rate} onChange={(event) => setEditDraft((current) => current ? { ...current, rate: Number(event.target.value) } : current)} />
            </Label>
            <label className="flex items-center gap-2 font-black text-steel-900">
              <input className="h-5 w-5" type="checkbox" checked={editDraft.active} onChange={(event) => setEditDraft((current) => current ? { ...current, active: event.target.checked } : current)} />
              Active
            </label>
            <div className="flex flex-wrap gap-2 pt-2">
              <button type="button" disabled={isSaving} className="touch-target flex items-center gap-2 rounded bg-workshop-500 px-4 py-2 font-black text-white disabled:bg-steel-500" onClick={saveEdit}>
                <Check size={19} />
                {isSaving ? "Saving..." : "Save Changes"}
              </button>
              <button type="button" disabled={isSaving} className="touch-target flex items-center gap-2 rounded bg-steel-100 px-4 py-2 font-black text-steel-900 disabled:opacity-60" onClick={() => setEditDraft(null)}>
                <X size={19} />
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function EmployeeAdmin({
  employees,
  locations,
  shifts,
  onCreate,
  onUpdate,
  onDelete
}: {
  employees: Employee[];
  locations: Location[];
  shifts: Shift[];
  onCreate: (employee: Omit<Employee, "id">) => void | Promise<void>;
  onUpdate: (id: string, patch: Partial<Employee>) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Omit<Employee, "id">>(emptyEmployee);
  const [editDraft, setEditDraft] = useState<Employee | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("Ready.");
  const [error, setError] = useState("");
  const [yardFilter, setYardFilter] = useState("all");

  function reset() {
    setDraft({ ...emptyEmployee, locationId: locations[0]?.id ?? "fontana", shift: shifts[0] ?? "AM" });
    setEditingId(null);
  }

  function edit(employee: Employee) {
    setEditingId(employee.id);
    setEditDraft({ ...employee });
    setMessage(`Editing ${employee.name}.`);
    setError("");
  }

  async function save() {
    const clean = { ...draft, name: draft.name.trim() };
    if (!clean.name) return;
    setIsSaving(true);
    setError("");
    try {
      await Promise.resolve(onCreate(clean));
      setMessage(`${clean.name} added.`);
      reset();
    } catch {
      setError("Could not save repairer. Try again.");
    } finally {
      setIsSaving(false);
    }
  }

  function handlePhoto(file: File | undefined, target: "create" | "edit" = "create") {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (target === "edit") {
        setEditDraft((current) => current ? { ...current, photoDataUrl: String(reader.result), photoPath: file.name } : current);
        return;
      }
      setDraft((current) => ({ ...current, photoDataUrl: String(reader.result), photoPath: file.name }));
    };
    reader.readAsDataURL(file);
  }

  async function saveEdit() {
    if (!editDraft) return;
    const clean = { ...editDraft, name: editDraft.name.trim() };
    if (!clean.name) {
      setError("Repairer name is required.");
      return;
    }

    setIsSaving(true);
    setError("");
    try {
      await Promise.resolve(onUpdate(clean.id, clean));
      setMessage(`${clean.name} saved.`);
      setEditDraft(null);
      setEditingId(null);
    } catch {
      setError("Could not save repairer changes. Try again.");
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteRepairer(employee: Employee) {
    if (!window.confirm(`Delete ${employee.name}?`)) {
      return;
    }

    setIsSaving(true);
    setError("");
    try {
      await Promise.resolve(onDelete(employee.id));
      setMessage(`${employee.name} deleted.`);
    } catch {
      setError("Could not delete repairer. Try again.");
    } finally {
      setIsSaving(false);
    }
  }

  const yardName = (id: string) => locations.find((location) => location.id === id)?.name ?? id;
  const grouped = yardFilter === "grouped";
  const visibleEmployees = yardFilter === "all" || grouped ? employees : employees.filter((employee) => employee.locationId === yardFilter);
  const sortByYardThenManager = (a: Employee, b: Employee) => {
    const byYard = yardName(a.locationId).localeCompare(yardName(b.locationId));
    if (byYard !== 0) return byYard;
    const managerRank = (employee: Employee) => (employee.role === "supervisor" ? 0 : 1);
    if (managerRank(a) !== managerRank(b)) return managerRank(a) - managerRank(b);
    return a.name.localeCompare(b.name);
  };
  const sortedEmployees = [...visibleEmployees].sort(sortByYardThenManager);
  // When grouped, split into one section per yard; otherwise one flat section.
  const sections = grouped
    ? locations
        .map((location) => ({ title: location.name, people: sortedEmployees.filter((employee) => employee.locationId === location.id) }))
        .filter((section) => section.people.length > 0)
    : [{ title: "", people: sortedEmployees }];

  return (
    <div className="grid gap-4">
      <SaveNotice message={message} error={error} />
      <div className="grid gap-3 md:grid-cols-[1fr_140px_140px_120px_auto]">
        <Label title="Repairer Name" icon={<UserRound size={17} />}>
          <input className="field" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Repairer name" />
        </Label>
        <Label title="Yard" icon={<MapPin size={17} />}>
          <select className="field" value={draft.locationId} onChange={(event) => setDraft((current) => ({ ...current, locationId: event.target.value }))}>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </Label>
        <Label title="Role" icon={<ShieldCheck size={17} />}>
          <select className="field" value={draft.role ?? "employee"} onChange={(event) => setDraft((current) => ({ ...current, role: event.target.value as Role }))}>
            <option value="employee">Repairer</option>
            <option value="supervisor">Yard Manager</option>
          </select>
        </Label>
        <Label title="Shift" icon={<Clock size={17} />}>
          <select className="field" value={draft.shift} onChange={(event) => setDraft((current) => ({ ...current, shift: event.target.value as Shift }))}>
            {shifts.map((shift) => (
              <option key={shift} value={shift}>
                {shift}
              </option>
            ))}
          </select>
        </Label>
        <label className="flex items-end gap-2 pb-1 font-black">
          <input className="h-5 w-5" type="checkbox" checked={draft.active} onChange={(event) => setDraft((current) => ({ ...current, active: event.target.checked }))} />
          Active
        </label>
      </div>
      <div className="grid gap-3 md:grid-cols-[220px_1fr]">
        <div className="grid gap-2">
          <span className="flex items-center gap-1.5 text-sm font-black">
            <ImagePlus size={17} />
            Profile Photo
          </span>
          <div className="flex items-center gap-3">
            <Avatar employee={{ ...draft, id: "draft" }} size="lg" />
            <div className="flex-1">
              <DropZone onFiles={(dropped) => handlePhoto(dropped[0])} label="Drag & drop or tap to add a photo" multiple={false} />
            </div>
          </div>
          {draft.photoDataUrl && (
            <button type="button" className="touch-target rounded bg-red-700 px-3 py-2 font-black text-white" onClick={() => setDraft((current) => ({ ...current, photoDataUrl: "", photoPath: "" }))}>
              Remove Photo
            </button>
          )}
        </div>
        <Label title="Notes" icon={<FileSpreadsheet size={17} />}>
          <textarea className="field min-h-28 resize-none" value={draft.notes ?? ""} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="Default station, skills, schedule, payroll notes" />
        </Label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={isSaving} className="touch-target flex items-center gap-2 rounded bg-workshop-500 px-4 py-2 font-black text-white disabled:cursor-not-allowed disabled:bg-steel-500" onClick={save}>
          <Check size={19} />
          {isSaving ? "Saving..." : "Add Repairer"}
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-[260px_1fr] sm:items-end">
        <Label title="Filter by Yard" icon={<MapPin size={17} />}>
          <select className="field" value={yardFilter} onChange={(event) => setYardFilter(event.target.value)}>
            <option value="all">All Yards (flat list)</option>
            <option value="grouped">Everyone, grouped by yard</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name} only
              </option>
            ))}
          </select>
        </Label>
        <p className="pb-2 text-sm font-bold text-steel-500">
          Showing {sortedEmployees.length} {sortedEmployees.length === 1 ? "person" : "people"}
          {yardFilter === "all" ? " across all yards" : grouped ? " grouped by yard" : ` in ${yardName(yardFilter)}`}.
        </p>
      </div>
      {sections.map((section) => (
        <div key={section.title || "all"} className="grid gap-3">
          {section.title && (
            <h3 className="flex items-center gap-2 border-b border-steel-100 pb-1 text-lg font-black">
              <MapPin size={18} className="text-workshop-700" />
              {section.title}
              <span className="text-sm font-bold text-steel-500">· {section.people.length}</span>
            </h3>
          )}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {section.people.map((employee) => (
              <div key={employee.id} className="rounded border border-steel-100 bg-white p-4 text-steel-900">
                <div className="flex items-start gap-3">
                  <Avatar employee={employee} size="lg" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-lg font-black">{employee.name}</h3>
                      {employee.role === "supervisor" && (
                        <span className="flex shrink-0 items-center gap-1 rounded bg-steel-900 px-2 py-0.5 text-xs font-black text-white">
                          <ShieldCheck size={12} />
                          Yard Manager
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-steel-500">{yardName(employee.locationId)} · {employee.shift}</p>
                    <p className="mt-1 text-sm text-steel-500">{employee.notes || "No notes"}</p>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-[1fr_52px_52px] gap-2">
                  <button type="button" className={classNames("touch-target rounded px-3 py-2 text-sm font-black", employee.active ? "bg-workshop-500 text-white" : "bg-steel-100 text-steel-700")} onClick={() => onUpdate(employee.id, { active: !employee.active })}>
                    {employee.active ? "Active" : "Inactive"}
                  </button>
                  <IconButton label={`Edit ${employee.name}`} icon={<Edit2 size={18} />} onClick={() => edit(employee)} />
                  <IconButton label={`Delete ${employee.name}`} icon={<Trash2 size={18} />} danger onClick={() => deleteRepairer(employee)} />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
      {editDraft && (
        <Modal title={`Edit ${editDraft.name}`} onClose={() => !isSaving && setEditDraft(null)}>
          <div className="grid gap-3">
            <Label title="Repairer Name" icon={<UserRound size={17} />}>
              <input className="field" value={editDraft.name} onChange={(event) => setEditDraft((current) => current ? { ...current, name: event.target.value } : current)} />
            </Label>
            <div className="grid gap-3 sm:grid-cols-3">
              <Label title="Yard" icon={<MapPin size={17} />}>
                <select className="field" value={editDraft.locationId} onChange={(event) => setEditDraft((current) => current ? { ...current, locationId: event.target.value } : current)}>
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </select>
              </Label>
              <Label title="Role" icon={<ShieldCheck size={17} />}>
                <select className="field" value={editDraft.role ?? "employee"} onChange={(event) => setEditDraft((current) => current ? { ...current, role: event.target.value as Role } : current)}>
                  <option value="employee">Repairer</option>
                  <option value="supervisor">Yard Manager</option>
                </select>
              </Label>
              <Label title="Shift" icon={<Clock size={17} />}>
                <select className="field" value={editDraft.shift} onChange={(event) => setEditDraft((current) => current ? { ...current, shift: event.target.value as Shift } : current)}>
                  {shifts.map((shift) => (
                    <option key={shift} value={shift}>
                      {shift}
                    </option>
                  ))}
                </select>
              </Label>
            </div>
            <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
              <div className="grid gap-2">
                <span className="flex items-center gap-1.5 text-sm font-black text-steel-900">
                  <ImagePlus size={17} />
                  Photo
                </span>
                <Avatar employee={editDraft} size="lg" />
                <DropZone onFiles={(dropped) => handlePhoto(dropped[0], "edit")} label="Drag & drop or tap to add a photo" multiple={false} />
                {editDraft.photoDataUrl && (
                  <button type="button" className="touch-target rounded bg-red-700 px-3 py-2 font-black text-white" onClick={() => setEditDraft((current) => current ? { ...current, photoDataUrl: "", photoPath: "" } : current)}>
                    Remove Photo
                  </button>
                )}
              </div>
              <Label title="Notes" icon={<FileSpreadsheet size={17} />}>
                <textarea className="field min-h-32 resize-none" value={editDraft.notes ?? ""} onChange={(event) => setEditDraft((current) => current ? { ...current, notes: event.target.value } : current)} />
              </Label>
            </div>
            <label className="flex items-center gap-2 font-black text-steel-900">
              <input className="h-5 w-5" type="checkbox" checked={editDraft.active} onChange={(event) => setEditDraft((current) => current ? { ...current, active: event.target.checked } : current)} />
              Active
            </label>
            <div className="flex flex-wrap gap-2 pt-2">
              <button type="button" disabled={isSaving} className="touch-target flex items-center gap-2 rounded bg-workshop-500 px-4 py-2 font-black text-white disabled:bg-steel-500" onClick={saveEdit}>
                <Check size={19} />
                {isSaving ? "Saving..." : "Save Repairer"}
              </button>
              <button type="button" disabled={isSaving} className="touch-target flex items-center gap-2 rounded bg-steel-100 px-4 py-2 font-black text-steel-900 disabled:opacity-60" onClick={() => setEditDraft(null)}>
                <X size={19} />
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function LocationShiftAdmin({ locations, shifts, onLocationsChange, onShiftsChange }: { locations: Location[]; shifts: Shift[]; onLocationsChange: (locations: Location[]) => void; onShiftsChange: (shifts: Shift[]) => void }) {
  const [locationName, setLocationName] = useState("");
  const [shiftName, setShiftName] = useState("");

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="grid gap-3">
        <h3 className="text-xl font-black">Locations</h3>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <input className="field" value={locationName} onChange={(event) => setLocationName(event.target.value)} placeholder="New location" />
          <button type="button" className="touch-target rounded bg-workshop-500 px-4 font-black text-white" onClick={() => {
            if (!locationName.trim()) return;
            onLocationsChange([...locations, { id: locationName.toLowerCase().replaceAll(" ", "-"), name: locationName.trim(), active: true }]);
            setLocationName("");
          }}>
            Add
          </button>
        </div>
        {locations.map((location) => (
          <div key={location.id} className="flex items-center justify-between rounded border border-steel-100 bg-white p-3 text-steel-900">
            <strong>{location.name}</strong>
            <div className="flex gap-2">
              <button type="button" className="rounded bg-steel-100 px-3 py-1 text-sm font-black" onClick={() => onLocationsChange(locations.map((item) => item.id === location.id ? { ...item, active: !item.active } : item))}>
                {location.active ? "Active" : "Inactive"}
              </button>
              <button type="button" className="rounded bg-red-700 px-3 py-1 text-sm font-black text-white" onClick={() => onLocationsChange(locations.filter((item) => item.id !== location.id))}>
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="grid gap-3">
        <h3 className="text-xl font-black">Shifts</h3>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <input className="field" value={shiftName} onChange={(event) => setShiftName(event.target.value)} placeholder="New shift" />
          <button type="button" className="touch-target rounded bg-workshop-500 px-4 font-black text-white" onClick={() => {
            if (!shiftName.trim()) return;
            onShiftsChange([...shifts, shiftName.trim() as Shift]);
            setShiftName("");
          }}>
            Add
          </button>
        </div>
        {shifts.map((shift) => (
          <div key={shift} className="flex items-center justify-between rounded border border-steel-100 bg-white p-3 text-steel-900">
            <strong>{shift}</strong>
            <button type="button" className="rounded bg-red-700 px-3 py-1 text-sm font-black text-white" onClick={() => onShiftsChange(shifts.filter((item) => item !== shift))}>
              Delete
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: CountSheetStatus }) {
  return (
    <span
      className={classNames(
        "rounded px-2 py-1 text-xs font-black",
        status === "Approved" && "bg-workshop-500 text-white",
        status === "Rejected" && "bg-red-700 text-white",
        status === "Pending" && "bg-steel-200 text-steel-900"
      )}
    >
      {status}
    </span>
  );
}

function EntryEditorModal({
  mode,
  entry,
  employees,
  locations,
  shifts,
  palletTypes,
  settings,
  onClose,
  onSave
}: {
  mode: "edit" | "view";
  entry: DailyEntry;
  employees: Employee[];
  locations: Location[];
  shifts: Shift[];
  palletTypes: PalletType[];
  settings: PayrollSettings;
  onClose: () => void;
  onSave: (entry: DailyEntry) => void;
}) {
  const [draft, setDraft] = useState<EntryForm>(() => entryToForm(entry, palletTypes));
  const readOnly = mode === "view";
  const calc = calculateEntry({ ...draft, id: entry.id, createdAt: entry.createdAt }, palletTypes, settings);
  const visiblePallets = palletTypes.filter((pallet) => pallet.active || draft.lines.some((line) => line.palletTypeId === pallet.id));

  function updateDraft<T extends keyof EntryForm>(key: T, value: EntryForm[T]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function updateQuantity(palletTypeId: string, quantity: number) {
    setDraft((current) => {
      const existing = current.lines.some((line) => line.palletTypeId === palletTypeId);
      const lines = existing
        ? current.lines.map((line) => (line.palletTypeId === palletTypeId ? { palletTypeId, quantity: Math.max(0, Number(quantity) || 0) } : line))
        : [...current.lines, { palletTypeId, quantity: Math.max(0, Number(quantity) || 0) }];
      return { ...current, lines };
    });
  }

  function save() {
    const cleanLines = draft.lines.filter((line) => line.quantity !== 0);
    // Keep the flat `lines` and the per-phase `phases` in sync so the edit reads
    // the same on the production grid, payroll, AND the entry screen (which is
    // phase-based). This modal edits aggregate quantities, so the totals land in
    // Phase 1 while every phase keeps its photos and bypassed state.
    const phases = normalizePhases(draft.phases).map((phase, index) => {
      const lines = index === 0 ? cleanLines : [];
      return { ...phase, lines, amount: phasePalletCount({ ...phase, lines }, palletTypes) };
    });
    onSave({
      ...entry,
      ...draft,
      manualHours: Number(draft.manualHours),
      lines: cleanLines,
      phases
    });
  }

  return (
    <Modal title={readOnly ? "View Production Entry" : "Edit Production Entry"} onClose={onClose}>
      <div className="grid gap-4">
        <div className="grid gap-3 md:grid-cols-4">
          <Label title="Date" icon={<CalendarDays size={17} />}>
            <CalendarField
              single
              disabled={readOnly}
              value={{ mode: "day", start: draft.date, end: draft.date }}
              onChange={(selection) => updateDraft("date", selection.start)}
            />
          </Label>
          <Label title="Repairer" icon={<UserRound size={17} />}>
            <select disabled={readOnly} className="field" value={draft.employeeId} onChange={(event) => updateDraft("employeeId", event.target.value)}>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>{employee.name}</option>
              ))}
            </select>
          </Label>
          <Label title="Location" icon={<MapPin size={17} />}>
            <select disabled={readOnly} className="field" value={draft.locationId} onChange={(event) => updateDraft("locationId", event.target.value)}>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>{location.name}</option>
              ))}
            </select>
          </Label>
          <Label title="Shift" icon={<Clock size={17} />}>
            <select disabled={readOnly} className="field" value={draft.shift} onChange={(event) => updateDraft("shift", event.target.value as Shift)}>
              {shifts.map((shift) => (
                <option key={shift} value={shift}>{shift}</option>
              ))}
            </select>
          </Label>
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          <Label title="Clock In" icon={<Clock size={17} />}>
            <select disabled={readOnly} className="field" value={draft.clockIn} onChange={(event) => updateDraft("clockIn", event.target.value)}>
              {timeOptions.map((time) => <option key={time} value={time}>{time}</option>)}
            </select>
          </Label>
          <Label title="Clock Out" icon={<Clock size={17} />}>
            <select disabled={readOnly} className="field" value={draft.clockOut} onChange={(event) => updateDraft("clockOut", event.target.value)}>
              {timeOptions.map((time) => <option key={time} value={time}>{time}</option>)}
            </select>
          </Label>
          <Label title="Hours" icon={<Clock size={17} />}>
            <input disabled={readOnly} className="field" type="number" min="0" step="0.25" value={draft.manualHours} onChange={(event) => updateDraft("manualHours", Number(event.target.value))} />
          </Label>
          <Label title="Break / Lunch" icon={<Clock size={17} />}>
            <select disabled={readOnly} className="field" value={draft.breakProfile} onChange={(event) => updateDraft("breakProfile", event.target.value as BreakProfile)}>
              <option value="standard">15 paid break + 30 unpaid lunch</option>
              <option value="paidLunch">Paid 30-minute lunch</option>
              <option value="noLunch">No lunch deduction</option>
            </select>
          </Label>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Metric label="Qty" value={wholeNumber(calc.quantity)} />
          <Metric label="Piece" value={currency(calc.pieceEarnings)} />
          <Metric label="Make-up" value={currency(calc.additionalOwed)} />
          <Metric label="OT" value={`${calc.overtimeHours.toFixed(2)} hrs`} />
          <Metric label="Total" value={currency(calc.totalPay)} />
        </div>
        <div className="overflow-hidden rounded border border-steel-100">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-steel-900 text-white">
                <tr>
                  <th className="p-3">Category</th>
                  <th className="p-3">Pallet</th>
                  <th className="p-3">Rate</th>
                  <th className="p-3">Quantity</th>
                  <th className="p-3">Earned</th>
                </tr>
              </thead>
              <tbody>
                {visiblePallets.map((pallet) => {
                  const lineForPallet = draft.lines.find((line) => line.palletTypeId === pallet.id);
                  const quantity = lineForPallet?.quantity ?? 0;
                  const parts = lineForPallet?.parts;
                  return (
                    <tr key={pallet.id} className="border-t border-steel-100 even:bg-steel-50">
                      <td className="p-3 font-black">{pallet.category}</td>
                      <td className="p-3"><strong>{pallet.code}</strong><span className="block text-steel-500">{pallet.description}</span></td>
                      <td className="p-3">{currency(pallet.rate)}</td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <input disabled={readOnly} className="field max-w-28 text-center font-black" type="number" min="0" placeholder="0" value={quantity === 0 ? "" : quantity} onChange={(event) => updateQuantity(pallet.id, Number(event.target.value))} />
                          {parts && parts.length > 1 && (
                            <span className="text-xs font-bold text-workshop-700">{parts.join(" + ")} = {quantity}</span>
                          )}
                        </div>
                      </td>
                      <td className="p-3 font-black">{currency(quantity * pallet.rate)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <Label title="Notes" icon={<FileSpreadsheet size={17} />}>
          <textarea disabled={readOnly} className="field min-h-24 resize-none" value={draft.notes ?? ""} onChange={(event) => updateDraft("notes", event.target.value)} />
        </Label>
        <div className="flex flex-wrap gap-2">
          {!readOnly && (
            <button type="button" className="touch-target flex items-center gap-2 rounded bg-workshop-500 px-4 py-2 font-black text-white" onClick={save}>
              <Save size={19} />
              Save Entry
            </button>
          )}
          <button type="button" className="touch-target rounded bg-steel-100 px-4 py-2 font-black text-steel-900" onClick={onClose}>Close</button>
        </div>
      </div>
    </Modal>
  );
}

function RepairerProfileModal({
  employee,
  entries,
  employees,
  locations,
  palletTypes,
  settings,
  selectedWeek,
  onClose,
  onEditEntry,
  onViewEntry
}: {
  employee?: Employee;
  entries: DailyEntry[];
  employees: Employee[];
  locations: Location[];
  palletTypes: PalletType[];
  settings: PayrollSettings;
  selectedWeek: string;
  onClose: () => void;
  onEditEntry: (entry: DailyEntry) => void;
  onViewEntry: (entry: DailyEntry) => void;
}) {
  if (!employee) return null;

  const weekDays = getWeekDays(selectedWeek);
  const employeeEntries = entries.filter((entry) => entry.employeeId === employee.id);
  const weeklyEntries = employeeEntries.filter((entry) => weekDays.includes(entry.date));
  const allReport = buildReport(employeeEntries, palletTypes, employees, locations, settings);
  const weekReport = buildReport(weeklyEntries, palletTypes, employees, locations, settings);

  return (
    <Modal title={`${employee.name} Profile`} onClose={onClose}>
      <div className="grid gap-4">
        <div className="flex items-center gap-4 rounded bg-steel-50 p-4">
          <Avatar employee={employee} size="lg" />
          <div>
            <h3 className="text-2xl font-black">{employee.name}</h3>
            <p className="text-steel-500">{locations.find((location) => location.id === employee.locationId)?.name ?? employee.locationId} · {employee.shift}</p>
            <p className="text-sm text-steel-500">{employee.notes || "No notes"}</p>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-4">
          <Metric label="Week Qty" value={wholeNumber(weekReport.summary.quantity)} />
          <Metric label="Week Pay" value={currency(weekReport.summary.totalPay)} />
          <Metric label="History Qty" value={wholeNumber(allReport.summary.quantity)} />
          <Metric label="History Pay" value={currency(allReport.summary.totalPay)} />
        </div>
        <div className="h-56 rounded border border-steel-100 p-3">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={weekDays.map((day) => {
              const dayReport = buildReport(weeklyEntries.filter((entry) => entry.date === day), palletTypes, employees, locations, settings);
              return { day: formatDayHeader(day).split(" ")[0], total: dayReport.summary.totalPay, quantity: dayReport.summary.quantity };
            })}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="day" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="quantity" fill="#2d7d71" name="Quantity" />
              <Bar dataKey="total" fill="#2a6b40" name="Pay" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <EntryHistory
          compact
          entries={employeeEntries.slice(0, 20)}
          employees={employees}
          locations={locations}
          palletTypes={palletTypes}
          settings={settings}
          onEditEntry={onEditEntry}
          onViewEntry={onViewEntry}
          onDeleteEntry={() => undefined}
          onSelectEmployee={() => undefined}
        />
      </div>
    </Modal>
  );
}

function getLinkedEntries(entries: DailyEntry[], sheet: Pick<CountSheet, "date" | "locationId" | "shift">) {
  return entries.filter((entry) => entry.date === sheet.date && entry.locationId === sheet.locationId && entry.shift === sheet.shift);
}

function getLinkedCountSheets(countSheets: CountSheet[], entry: Pick<DailyEntry, "date" | "locationId" | "shift">) {
  return countSheets.filter((sheet) => sheet.date === entry.date && sheet.locationId === entry.locationId && sheet.shift === entry.shift);
}

function buildCountSheetStats(countSheets: CountSheet[], entries: DailyEntry[], locations: Location[], shifts: Shift[]) {
  const uploadedToday = countSheets.filter((sheet) => sheet.date === today).length;
  const pending = countSheets.filter((sheet) => sheet.status === "Pending").length;
  const approved = countSheets.filter((sheet) => sheet.status === "Approved").length;
  const rejected = countSheets.filter((sheet) => sheet.status === "Rejected").length;
  const productionKeys = new Map<string, { date: string; locationId: string; shift: Shift }>();

  for (const entry of entries) {
    productionKeys.set(`${entry.date}|${entry.locationId}|${entry.shift}`, {
      date: entry.date,
      locationId: entry.locationId,
      shift: entry.shift
    });
  }

  const uploadedKeys = new Set(countSheets.map((sheet) => `${sheet.date}|${sheet.locationId}|${sheet.shift}`));
  const missing = Array.from(productionKeys.values())
    .filter((item) => !uploadedKeys.has(`${item.date}|${item.locationId}|${item.shift}`))
    .map((item) => `${item.date} ${locations.find((location) => location.id === item.locationId)?.name ?? item.locationId} ${item.shift}`);

  return {
    uploadedToday,
    pending,
    approved,
    rejected,
    missing,
    expectedToday: locations.filter((location) => location.active).length * shifts.length
  };
}

function getPalletDisplay(pallet: PalletType | undefined, palletTypeId: string) {
  if (!pallet) {
    console.warn(`Unknown pallet type referenced in production entry: ${palletTypeId}`);
    return {
      label: `Unknown Pallet Type (ID: ${palletTypeId || "missing"})`,
      category: "Unknown",
      rate: 0
    };
  }

  const code = pallet.code.trim();
  const description = pallet.description.trim();
  const isInternalCode = /^(no-\d+|undefined|null)$/i.test(code);
  const label = [isInternalCode ? "" : code, description].filter(Boolean).join(" ").trim();

  if (!label || /^(no-\d+|undefined|null)$/i.test(label)) {
    console.warn(`Pallet type has an unsafe display label: ${pallet.id}`);
  }

  return {
    label: label || "Unknown Pallet Type",
    category: pallet.category || "Unknown",
    rate: Number(pallet.rate) || 0
  };
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function findPalletType(palletTypes: PalletType[], palletTypeId: string) {
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

function getResolvedPalletTypeId(palletTypes: PalletType[], palletTypeId: string) {
  return findPalletType(palletTypes, palletTypeId)?.id ?? palletTypeId;
}

function buildReport(entries: DailyEntry[], palletTypes: PalletType[], employees: Employee[], locations: Location[], settings: PayrollSettings) {
  const byPalletMap = new Map<string, { id: string; palletTypeId: string; label: string; category: string; quantity: number; piecePay: number; orphaned: boolean }>();
  const byEmployeeMap = new Map<string, { employee: Employee; quantity: number; piecePay: number; makeup: number; totalPay: number; hours: number; dailyOvertime: number; weeklyOvertime: number }>();
  const byDayMap = new Map<string, { label: string; quantity: number; piecePay: number; totalPay: number }>();
  const byWeekMap = new Map<string, { label: string; quantity: number; piecePay: number; totalPay: number }>();
  const weeklyHours = new Map<string, number>();

  const summary = { quantity: 0, piecePay: 0, makeup: 0, totalPay: 0, dailyOvertime: 0, weeklyOvertime: 0 };

  for (const entry of entries) {
    const calc = calculateEntry(entry, palletTypes, settings);
    const employee = employees.find((item) => item.id === entry.employeeId) ?? { id: entry.employeeId, name: entry.employeeId, locationId: entry.locationId, shift: entry.shift, active: true };
    const employeeRow = byEmployeeMap.get(employee.id) ?? { employee, quantity: 0, piecePay: 0, makeup: 0, totalPay: 0, hours: 0, dailyOvertime: 0, weeklyOvertime: 0 };
    const weekKey = getWeekKey(entry.date);
    weeklyHours.set(`${employee.id}-${weekKey}`, (weeklyHours.get(`${employee.id}-${weekKey}`) ?? 0) + calc.paidHours);

    summary.quantity += calc.quantity;
    summary.piecePay += calc.pieceEarnings;
    summary.makeup += calc.additionalOwed;
    summary.totalPay += calc.totalPay;
    summary.dailyOvertime += calc.overtimeHours;

    employeeRow.quantity += calc.quantity;
    employeeRow.piecePay += calc.pieceEarnings;
    employeeRow.makeup += calc.additionalOwed;
    employeeRow.totalPay += calc.totalPay;
    employeeRow.hours += calc.paidHours;
    employeeRow.dailyOvertime += calc.overtimeHours;
    byEmployeeMap.set(employee.id, employeeRow);

    const day = byDayMap.get(entry.date) ?? { label: entry.date, quantity: 0, piecePay: 0, totalPay: 0 };
    day.quantity += calc.quantity;
    day.piecePay += calc.pieceEarnings;
    day.totalPay += calc.totalPay;
    byDayMap.set(entry.date, day);

    const week = byWeekMap.get(weekKey) ?? { label: weekKey, quantity: 0, piecePay: 0, totalPay: 0 };
    week.quantity += calc.quantity;
    week.piecePay += calc.pieceEarnings;
    week.totalPay += calc.totalPay;
    byWeekMap.set(weekKey, week);

    for (const line of entry.lines) {
      if (!line.palletTypeId) {
        console.warn(`Production entry ${entry.id} has a missing palletTypeId.`);
      }
      const pallet = findPalletType(palletTypes, line.palletTypeId);
      const palletDisplay = getPalletDisplay(pallet, line.palletTypeId);
      const key = pallet?.id ?? `unknown-${line.palletTypeId || entry.id}`;
      const row = byPalletMap.get(key) ?? {
        id: key,
        palletTypeId: line.palletTypeId || "missing",
        label: palletDisplay.label,
        category: palletDisplay.category,
        quantity: 0,
        piecePay: 0,
        orphaned: !pallet
      };
      row.quantity += line.quantity;
      row.piecePay += line.quantity * palletDisplay.rate;
      byPalletMap.set(key, row);
    }
  }

  for (const [key, hours] of weeklyHours) {
    const employeeId = key.split("-").slice(0, -3).join("-");
    const overtime = Math.max(0, hours - 40);
    const row = byEmployeeMap.get(employeeId);
    if (row) {
      row.weeklyOvertime += overtime;
      summary.weeklyOvertime += overtime;
    }
  }

  return {
    summary,
    byPallet: Array.from(byPalletMap.values()).sort((a, b) => b.quantity - a.quantity),
    byEmployee: Array.from(byEmployeeMap.values()).sort((a, b) => b.quantity - a.quantity),
    byDay: Array.from(byDayMap.values()).sort((a, b) => a.label.localeCompare(b.label)),
    byWeek: Array.from(byWeekMap.values()).sort((a, b) => a.label.localeCompare(b.label)),
    locations
  };
}

function Leaderboard({ rows, onSelectEmployee }: { rows: ReturnType<typeof buildReport>["byEmployee"]; onSelectEmployee: (employeeId: string) => void }) {
  return (
    <div className="rounded border border-steel-100 bg-white p-4 text-steel-900">
      <h3 className="mb-3 text-lg font-black">Top Repairers</h3>
      <div className="grid gap-3">
        {rows.slice(0, 6).map((row) => (
          <div key={row.employee.id} className="flex items-center justify-between gap-3 rounded bg-steel-50 p-3">
            <button type="button" className="flex items-center gap-3 text-left" onClick={() => onSelectEmployee(row.employee.id)}>
              <Avatar employee={row.employee} />
              <div>
                <strong className="block">{row.employee.name}</strong>
                <span className="text-sm text-steel-500">{wholeNumber(row.quantity)} pallets</span>
              </div>
            </button>
            <strong>{currency(row.totalPay)}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmployeeTable({ rows, onSelectEmployee }: { rows: ReturnType<typeof buildReport>["byEmployee"]; onSelectEmployee: (employeeId: string) => void }) {
  return (
    <div className="overflow-hidden rounded border border-steel-100 bg-white text-steel-900">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-steel-900 text-white">
            <tr>
              <th className="p-3">Employee</th>
              <th className="p-3">Quantity</th>
              <th className="p-3">Hours</th>
              <th className="p-3">Piece Pay</th>
              <th className="p-3">Make-up</th>
              <th className="p-3">Daily OT</th>
              <th className="p-3">Weekly OT</th>
              <th className="p-3">Total Pay</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.employee.id} className="border-t border-steel-100 even:bg-steel-50">
                <td className="p-3">
                  <button type="button" className="flex items-center gap-2 font-black text-workshop-700" onClick={() => onSelectEmployee(row.employee.id)}>
                    <Avatar employee={row.employee} />
                    <strong>{row.employee.name}</strong>
                  </button>
                </td>
                <td className="p-3">{wholeNumber(row.quantity)}</td>
                <td className="p-3">{row.hours.toFixed(2)}</td>
                <td className="p-3">{currency(row.piecePay)}</td>
                <td className="p-3">{currency(row.makeup)}</td>
                <td className="p-3">{row.dailyOvertime.toFixed(2)}</td>
                <td className="p-3">{row.weeklyOvertime.toFixed(2)}</td>
                <td className="p-3 font-black">{currency(row.totalPay)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BreakdownTable({ title, rows }: { title: string; rows: Array<{ id?: string; palletTypeId?: string; label: string; category?: string; quantity: number; piecePay: number }> }) {
  return (
    <div className="overflow-hidden rounded border border-steel-100 bg-white text-steel-900">
      <div className="border-b border-steel-100 p-3">
        <h3 className="text-lg font-black">{title}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-left text-sm">
          <thead className="bg-steel-50">
            <tr>
              <th className="p-3">Type</th>
              <th className="p-3">Category</th>
              <th className="p-3">Quantity</th>
              <th className="p-3">Piece Pay</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.id ?? row.palletTypeId ?? `${row.label}-${row.category}-${index}`} className="border-t border-steel-100 even:bg-steel-50">
                <td className="p-3 font-black">{row.label}</td>
                <td className="p-3">{row.category ?? ""}</td>
                <td className="p-3">{wholeNumber(row.quantity)}</td>
                <td className="p-3">{currency(row.piecePay)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ id: string; name: string }> }) {
  return (
    <Label title={label} icon={<Filter size={17} />}>
      <select className="field" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    </Label>
  );
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const { t } = useT();
  const contentRef = useRef<HTMLDivElement>(null);

  // Pop the pop-up's content out into its own browser tab: copy the page's
  // stylesheets so it looks the same, and drop in the modal's current HTML
  // (inline data-URL photos come along, so they render there too).
  function openInNewTab() {
    const node = contentRef.current;
    const win = window.open("", "_blank");
    if (!node || !win) return;
    const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
      .map((element) => element.outerHTML)
      .join("");
    win.document.write(
      `<!doctype html><html><head><meta charset="utf-8">` +
        `<meta name="viewport" content="width=device-width, initial-scale=1">` +
        `<title>${title}</title>${styles}</head>` +
        `<body class="bg-white text-steel-900"><div class="mx-auto max-w-3xl p-6">` +
        `<h1 class="mb-4 text-2xl font-black">${title}</h1>${node.innerHTML}</div></body></html>`
    );
    win.document.close();
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-steel-900/70 p-0 sm:place-items-center sm:p-4">
      <div className="max-h-[92vh] w-full overflow-y-auto rounded-t bg-white p-4 text-steel-900 shadow-panel sm:max-w-2xl sm:rounded">
        <div className="mb-4 flex items-center justify-between gap-3 border-b border-steel-100 pb-3">
          <h3 className="min-w-0 truncate text-xl font-black">{title}</h3>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={openInNewTab}
              className="flex items-center gap-1.5 rounded bg-steel-100 px-3 py-2 text-sm font-black text-steel-900 hover:bg-steel-200"
            >
              <ExternalLink size={16} />
              <span className="hidden sm:inline">{t("Open in new tab")}</span>
            </button>
            <button type="button" aria-label="Close edit modal" className="touch-target flex w-12 items-center justify-center rounded bg-steel-100 text-steel-900" onClick={onClose}>
              <X size={20} />
            </button>
          </div>
        </div>
        <div ref={contentRef}>{children}</div>
      </div>
    </div>
  );
}

function SaveNotice({ message, error }: { message: string; error: string }) {
  return (
    <div className={classNames("rounded border px-3 py-2 text-sm font-bold", error ? "border-red-200 bg-red-50 text-red-800" : "border-workshop-500/20 bg-workshop-500/10 text-workshop-700")}>
      {error || message}
    </div>
  );
}

function Avatar({ employee, size = "sm" }: { employee?: Partial<Employee>; size?: "sm" | "lg" }) {
  const dimension = size === "lg" ? "h-14 w-14" : "h-10 w-10";
  const initials = employee?.name?.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "MG";

  return (
    <div className={classNames("flex shrink-0 items-center justify-center overflow-hidden rounded bg-safety-400 font-black text-steel-900", dimension)}>
      {employee?.photoDataUrl ? <img src={employee.photoDataUrl} alt="" className="h-full w-full object-cover" /> : initials}
    </div>
  );
}

function NavButton({ icon, label, active, onClick }: { icon: ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" className={classNames("touch-target flex min-w-32 flex-1 items-center justify-center gap-2 rounded px-3 py-2 text-sm font-black", active ? "bg-steel-900 text-white" : "bg-transparent text-inherit")} onClick={onClick}>
      {icon}
      {label}
    </button>
  );
}

function AdminTabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" className={classNames("touch-target rounded px-4 py-2 font-black", active ? "bg-steel-900 text-white" : "bg-white text-steel-900")} onClick={onClick}>
      {label}
    </button>
  );
}

function IconButton({ label, icon, danger, onClick }: { label: string; icon: ReactNode; danger?: boolean; onClick: () => void }) {
  return (
    <button type="button" aria-label={label} className={classNames("touch-target flex w-12 items-center justify-center rounded text-white", danger ? "bg-red-700" : "bg-steel-900")} onClick={onClick}>
      {icon}
    </button>
  );
}

function Label({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="flex items-center gap-1.5 text-sm font-black">
        {icon}
        {title}
      </span>
      {children}
    </label>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-steel-100 bg-white p-3 text-steel-900 shadow-panel">
      <p className="text-xs font-black uppercase text-steel-500">{label}</p>
      <p className="mt-1 text-xl font-black">{value}</p>
    </div>
  );
}

function CloudBrowser({
  entries,
  employees,
  locations,
  palletTypes,
  settings,
  changeLog,
  onViewEntry
}: {
  entries: DailyEntry[];
  employees: Employee[];
  locations: Location[];
  palletTypes: PalletType[];
  settings: PayrollSettings;
  changeLog: ChangeLogEntry[];
  onViewEntry: (entry: DailyEntry) => void;
}) {
  const employeeName = (id: string) => employees.find((employee) => employee.id === id)?.name ?? id;
  const locationName = (id: string) => locations.find((location) => location.id === id)?.name ?? id;
  const palletCount = (entry: DailyEntry) => entry.lines.reduce((sum, line) => sum + line.quantity, 0);

  const byUser = useMemo(() => {
    const groups = new Map<string, DailyEntry[]>();
    for (const entry of entries) {
      const key = entry.submittedBy?.trim() || "Unassigned";
      const list = groups.get(key) ?? [];
      list.push(entry);
      groups.set(key, list);
    }
    return Array.from(groups.entries())
      .map(([user, list]) => ({ user, list }))
      .sort((a, b) => a.user.localeCompare(b.user));
  }, [entries]);

  const totalPallets = entries.reduce((sum, entry) => sum + palletCount(entry), 0);
  const totalDays = new Set(entries.map((entry) => entry.date)).size;

  return (
    <div className="grid gap-4">
      <div>
        <h2 className="text-2xl font-black">Cloud Records</h2>
        <p className="text-sm text-steel-500">Everything saved to the cloud, organized by user and day.</p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="Users" value={wholeNumber(byUser.length)} />
        <Metric label="Entries" value={wholeNumber(entries.length)} />
        <Metric label="Days" value={wholeNumber(totalDays)} />
        <Metric label="Pallets" value={wholeNumber(totalPallets)} />
      </div>

      {entries.length === 0 && (
        <div className="rounded border border-steel-100 bg-white p-5 text-center font-bold text-steel-500">
          No cloud records yet. Saved entries will appear here, grouped by who entered them.
        </div>
      )}

      {byUser.map(({ user, list }) => {
        const byDate = new Map<string, DailyEntry[]>();
        for (const entry of [...list].sort((a, b) => b.date.localeCompare(a.date))) {
          const dayList = byDate.get(entry.date) ?? [];
          dayList.push(entry);
          byDate.set(entry.date, dayList);
        }

        return (
          <div key={user} className="rounded border border-steel-100 bg-white p-4 text-steel-900">
            <div className="mb-3 flex items-center gap-2">
              <UserRound size={18} className="text-workshop-700" />
              <h3 className="text-lg font-black">{user}</h3>
              <span className="text-sm font-bold text-steel-500">· {list.length} {list.length === 1 ? "entry" : "entries"}</span>
            </div>

            <div className="grid gap-3">
              {Array.from(byDate.entries()).map(([date, dayEntries]) => {
                const dayPallets = dayEntries.reduce((sum, entry) => sum + palletCount(entry), 0);
                const dayTotal = dayEntries.reduce((sum, entry) => sum + calculateEntry(entry, palletTypes, settings).totalPay, 0);

                return (
                  <div key={date} className="rounded border border-steel-100 bg-steel-50 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <strong className="flex items-center gap-1.5">
                        <CalendarDays size={16} />
                        {date}
                      </strong>
                      <span className="text-sm font-bold text-steel-500">{wholeNumber(dayPallets)} pallets · {currency(dayTotal)}</span>
                    </div>

                    <div className="mt-2 grid gap-2">
                      {dayEntries.map((entry) => {
                        const calc = calculateEntry(entry, palletTypes, settings);
                        return (
                          <button
                            key={entry.id}
                            type="button"
                            onClick={() => onViewEntry(entry)}
                            className="flex flex-wrap items-center justify-between gap-2 rounded border border-steel-100 bg-white px-3 py-2 text-left"
                          >
                            <span className="font-black">{employeeName(entry.employeeId)}</span>
                            <span className="text-sm text-steel-500">
                              {locationName(entry.locationId)} · {entry.shift} · {wholeNumber(palletCount(entry))} pallets · {currency(calc.totalPay)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      <div className="mt-2 rounded border border-steel-100 bg-white p-4 text-steel-900">
        <div className="mb-3 flex items-center gap-2">
          <Clock size={18} className="text-workshop-700" />
          <h3 className="text-lg font-black">Change Log</h3>
          <span className="text-sm font-bold text-steel-500">· profile changes, newest first</span>
        </div>
        {changeLog.length === 0 ? (
          <p className="text-sm font-bold text-steel-500">No changes recorded yet. Edits to repairer profiles will show here.</p>
        ) : (
          <div className="grid gap-2">
            {changeLog.map((log, index) => (
              <div key={log.id ?? index} className="rounded border border-steel-100 bg-steel-50 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong>
                    {log.actor} {log.action} {log.targetName}
                  </strong>
                  <span className="text-xs font-bold text-steel-500">{log.at ? new Date(log.at).toLocaleString() : ""}</span>
                </div>
                {log.summary && <p className="mt-1 text-steel-700">{log.summary}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

type UserRow = {
  id: string;
  email: string;
  username: string;
  fullName: string;
  role: string;
  active: boolean;
  // Yards this manager may view; empty = all yards.
  allowedYards: string[];
};

const userRoleOptions: Array<{ value: string; label: string }> = [
  { value: "admin", label: "Admin" },
  { value: "supervisor", label: "Manager" },
  { value: "employee", label: "Counter" }
];

// The yards a Manager can be granted access to.
const userYardChoices: Array<{ value: string; label: string }> = defaultLocations
  .filter((location) => location.active)
  .map((location) => ({ value: location.id, label: location.name }));

function allowedYardsLabel(allowedYards: string[]): string {
  if (allowedYards.length === 0 || allowedYards.length === userYardChoices.length) return "All yards";
  return userYardChoices.filter((choice) => allowedYards.includes(choice.value)).map((choice) => choice.label).join(", ");
}

// Checkbox dropdown for picking which yards a manager can view.
function YardAccessPicker({ value, disabled, onChange }: { value: string[]; disabled?: boolean; onChange: (next: string[]) => void }) {
  const [open, setOpen] = useState(false);
  function toggleYard(yardId: string) {
    onChange(value.includes(yardId) ? value.filter((item) => item !== yardId) : [...value, yardId]);
  }
  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className={classNames("field flex items-center justify-between gap-2 text-left font-black disabled:opacity-50", disabled ? "text-steel-400" : "text-steel-900")}
      >
        <span className="truncate">{allowedYardsLabel(value)}</span>
        <span className="text-steel-400">▾</span>
      </button>
      {open && !disabled && (
        <div className="absolute right-0 z-20 mt-1 w-48 rounded border border-steel-200 bg-white p-1 shadow-panel">
          {userYardChoices.map((choice) => (
            <label key={choice.value} className="flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm font-bold text-steel-900 hover:bg-steel-50">
              <input type="checkbox" className="h-4 w-4" checked={value.includes(choice.value)} onChange={() => toggleYard(choice.value)} />
              {choice.label}
            </label>
          ))}
          <p className="px-2 py-1 text-xs font-bold text-steel-400">None checked = all yards</p>
        </div>
      )}
    </div>
  );
}

function UsersAdmin({ onLogChange }: { onLogChange: (targetName: string, summary: string) => void }) {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<{ fullName: string; login: string; password: string; role: string; allowedYards: string[] }>({ fullName: "", login: "", password: "", role: "employee", allowedYards: [] });
  // Per-user permissions editor (role + yards + active) staged until "Save".
  const [editingId, setEditingId] = useState<string | null>(null);
  const [permDraft, setPermDraft] = useState<{ role: string; allowedYards: string[]; active: boolean }>({ role: "employee", allowedYards: [], active: true });
  const [savingPerms, setSavingPerms] = useState(false);
  // A password shown once right after it is set (reveal-on-set), with a copy button.
  const [setPassword, setSetPassword] = useState<{ name: string; value: string } | null>(null);
  // Per-user "See password" gate: which user's panel is open, the admin password
  // typed to unlock it, whether we're checking, and the revealed value.
  const [seeFor, setSeeFor] = useState<string | null>(null);
  const [adminPw, setAdminPw] = useState("");
  const [seeBusy, setSeeBusy] = useState(false);
  const [seenPassword, setSeenPassword] = useState<{ id: string; value: string | null } | null>(null);

  function copyText(text: string) {
    navigator.clipboard?.writeText(text).catch(() => undefined);
  }

  // Suggest a readable password like "Pallet-4821".
  function generatePassword() {
    const words = ["Pallet", "Repair", "Forklift", "Lumber", "Stacker", "Yard", "Crew", "Board"];
    const word = words[Math.floor(Math.random() * words.length)];
    const value = `${word}-${Math.floor(1000 + Math.random() * 9000)}`;
    setForm((current) => ({ ...current, password: value }));
  }

  function openSee(user: UserRow) {
    setSeeFor((prev) => (prev === user.id ? null : user.id));
    setAdminPw("");
    setSeenPassword(null);
    setError("");
    setMessage("");
  }

  async function revealPassword(user: UserRow) {
    if (!adminPw) return;
    setSeeBusy(true);
    setError("");
    try {
      const response = await authedFetch(`/api/admin/users/${user.id}/password`, {
        method: "POST",
        body: JSON.stringify({ adminPassword: adminPw })
      });
      const data = await response.json();
      if (!data.ok) {
        setError(data.error ?? "Could not verify your password.");
        return;
      }
      setSeenPassword({ id: user.id, value: (data.password as string | null) ?? null });
      setAdminPw("");
    } catch {
      setError("Could not verify. Try again.");
    } finally {
      setSeeBusy(false);
    }
  }

  function openPermissions(user: UserRow) {
    setEditingId(user.id);
    setPermDraft({ role: user.role, allowedYards: user.allowedYards, active: user.active });
    setError("");
    setMessage("");
  }

  function describePermissions(user: UserRow, draft: { role: string; allowedYards: string[]; active: boolean }): string {
    const roleLabel = (value: string) => userRoleOptions.find((option) => option.value === value)?.label ?? value;
    const parts: string[] = [];
    if (draft.role !== user.role) parts.push(`role ${roleLabel(user.role)} → ${roleLabel(draft.role)}`);
    const beforeYards = draft.role === "supervisor" ? allowedYardsLabel(user.allowedYards) : "All yards";
    const afterYards = draft.role === "supervisor" ? allowedYardsLabel(draft.allowedYards) : "All yards";
    if (afterYards !== beforeYards) parts.push(`yards ${beforeYards} → ${afterYards}`);
    if (draft.active !== user.active) parts.push(draft.active ? "set Active" : "set Inactive");
    return parts.join(", ");
  }

  async function authedFetch(url: string, options: RequestInit = {}) {
    const token = getAccessToken();
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 15000);
    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: { ...(options.headers ?? {}), "Content-Type": "application/json", Authorization: `Bearer ${token}` }
      });
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function load() {
    try {
      const response = await authedFetch("/api/admin/users");
      const data = await response.json();
      if (data.error) {
        setError(data.error);
        return;
      }
      setError("");
      setUsers(data.users ?? []);
    } catch (caught) {
      setError((caught as Error)?.name === "AbortError" ? "Loading users timed out — try again." : "Could not load users.");
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function addUser(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const justSetName = form.fullName || form.login;
      const justSetValue = form.password;
      const response = await authedFetch("/api/admin/users", { method: "POST", body: JSON.stringify(form) });
      const data = await response.json();
      if (!data.ok) {
        setError(data.error ?? "Could not add user.");
        return;
      }
      setMessage(`Added ${justSetName}.`);
      setSetPassword({ name: justSetName, value: justSetValue });
      setForm({ fullName: "", login: "", password: "", role: "employee", allowedYards: [] });
      load();
    } catch (caught) {
      setError((caught as Error)?.name === "AbortError" ? "Request timed out — try again." : "Could not add user.");
    } finally {
      setBusy(false);
    }
  }

  async function patchUser(id: string, patch: Record<string, unknown>, successMessage: string) {
    setError("");
    const response = await authedFetch(`/api/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
    const data = await response.json();
    if (!data.ok) {
      setError(data.error ?? "Update failed.");
      return;
    }
    setMessage(successMessage);
    load();
  }

  // Save the staged permissions for one user and record it on the cloud audit log.
  async function savePermissions(user: UserRow) {
    const summary = describePermissions(user, permDraft);
    if (!summary) {
      setEditingId(null);
      return;
    }
    setSavingPerms(true);
    setError("");
    try {
      const response = await authedFetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify({ role: permDraft.role, allowedYards: permDraft.allowedYards, active: permDraft.active })
      });
      const data = await response.json();
      if (!data.ok) {
        setError(data.error ?? "Could not save permissions.");
        return;
      }
      onLogChange(user.fullName || user.username || user.email, summary);
      setMessage(`Permissions saved for ${user.fullName || user.username} and logged to the cloud.`);
      setEditingId(null);
      load();
    } catch {
      setError("Could not save permissions. Try again.");
    } finally {
      setSavingPerms(false);
    }
  }

  function renameUser(user: UserRow) {
    const name = window.prompt("New name:", user.fullName);
    if (name === null) return;
    patchUser(user.id, { fullName: name }, `Renamed to ${name}.`);
  }

  async function resetPassword(user: UserRow) {
    const password = window.prompt(`New password for ${user.fullName || user.username} (min 6 characters):`);
    if (!password) return;
    setError("");
    const response = await authedFetch(`/api/admin/users/${user.id}`, { method: "PATCH", body: JSON.stringify({ password }) });
    const data = await response.json();
    if (!data.ok) {
      setError(data.error ?? "Update failed.");
      return;
    }
    setMessage(`Password reset for ${user.fullName || user.username}.`);
    setSetPassword({ name: user.fullName || user.username, value: password });
    load();
  }

  async function deleteUser(user: UserRow) {
    if (!window.confirm(`Delete ${user.fullName || user.username}? This permanently removes their login.`)) return;
    setError("");
    const response = await authedFetch(`/api/admin/users/${user.id}`, { method: "DELETE" });
    const data = await response.json();
    if (!data.ok) {
      setError(data.error ?? "Delete failed.");
      return;
    }
    setMessage("User deleted.");
    load();
  }

  return (
    <div className="grid gap-4 text-steel-900">
      <div>
        <h2 className="text-2xl font-black">Users</h2>
        <p className="text-sm text-steel-500">Add logins, rename people, change roles, reset passwords. Admins only.</p>
      </div>

      {(message || error) && (
        <div className={classNames("rounded border p-3 text-sm font-bold", error ? "border-red-200 bg-red-50 text-red-700" : "border-steel-100 bg-workshop-100 text-steel-900")}>
          {error || message}
        </div>
      )}

      {setPassword && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-workshop-500 bg-workshop-100 p-3">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-wide text-workshop-700">Password for {setPassword.name}</p>
            <p className="font-mono text-xl font-black text-steel-900">{setPassword.value}</p>
            <p className="text-xs font-bold text-steel-500">Share this with them now. You can re-view it later with your admin password.</p>
          </div>
          <div className="flex gap-2">
            <button type="button" className="rounded bg-workshop-500 px-3 py-2 text-sm font-black text-white" onClick={() => copyText(setPassword.value)}>Copy</button>
            <button type="button" className="rounded bg-steel-100 px-3 py-2 text-sm font-black text-steel-700" onClick={() => setSetPassword(null)}>Dismiss</button>
          </div>
        </div>
      )}

      <form onSubmit={addUser} className="grid gap-3 rounded border border-steel-100 bg-white p-4 sm:grid-cols-2 lg:grid-cols-3 lg:items-end">
        <Label title="Full Name" icon={<UserRound size={16} />}>
          <input className="field" value={form.fullName} onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value }))} placeholder="Madison Smith" />
        </Label>
        <Label title="Username or Email" icon={<UserRound size={16} />}>
          <input className="field" value={form.login} onChange={(event) => setForm((current) => ({ ...current, login: event.target.value }))} placeholder="madison or madison@email.com" autoCapitalize="none" />
        </Label>
        <Label title="Password" icon={<ShieldCheck size={16} />}>
          <div className="flex gap-2">
            <input className="field" value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} placeholder="min 6 characters" />
            <button type="button" onClick={generatePassword} className="shrink-0 rounded bg-steel-100 px-3 text-sm font-black text-steel-700">Generate</button>
          </div>
        </Label>
        <Label title="Role" icon={<ShieldCheck size={16} />}>
          <select className="field" value={form.role} onChange={(event) => setForm((current) => ({ ...current, role: event.target.value }))}>
            {userRoleOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </Label>
        <Label title="Manager Yards" icon={<MapPin size={16} />}>
          <YardAccessPicker
            value={form.allowedYards}
            disabled={form.role !== "supervisor"}
            onChange={(next) => setForm((current) => ({ ...current, allowedYards: next }))}
          />
        </Label>
        <button type="submit" disabled={busy} className="touch-target flex items-center justify-center gap-2 rounded bg-workshop-500 px-4 font-black text-white disabled:bg-steel-300">
          <Check size={18} />
          {busy ? "Adding…" : "Add User"}
        </button>
      </form>

      <div className="grid gap-2">
        {users.map((user) => (
          <div key={user.id} className="rounded border border-steel-100 bg-white p-3">
            <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
              <div className="min-w-0">
                <p className="truncate text-lg font-black">{user.fullName || user.username || user.email}</p>
                <p className="truncate text-sm text-steel-500">
                  {user.email}{user.username ? ` · @${user.username}` : ""}
                  {` · ${userRoleOptions.find((option) => option.value === user.role)?.label ?? user.role}`}
                  {user.role === "supervisor" ? ` · ${allowedYardsLabel(user.allowedYards)}` : ""}
                  {!user.active ? " · Inactive" : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={classNames("rounded px-3 py-2 text-sm font-black", editingId === user.id ? "bg-steel-900 text-white" : "bg-workshop-100 text-workshop-700")}
                  onClick={() => (editingId === user.id ? setEditingId(null) : openPermissions(user))}
                >
                  {editingId === user.id ? "Close" : "Permissions"}
                </button>
                <button type="button" className="rounded bg-steel-100 px-3 py-2 text-sm font-black text-steel-900" onClick={() => renameUser(user)}>Rename</button>
                <button
                  type="button"
                  className={classNames("rounded px-3 py-2 text-sm font-black", seeFor === user.id ? "bg-steel-900 text-white" : "bg-steel-100 text-steel-900")}
                  onClick={() => openSee(user)}
                >
                  {seeFor === user.id ? "Close" : "See Password"}
                </button>
                <button type="button" className="rounded bg-steel-100 px-3 py-2 text-sm font-black text-steel-900" onClick={() => resetPassword(user)}>Reset Password</button>
                <button type="button" className="rounded bg-red-700 px-3 py-2 text-sm font-black text-white" onClick={() => deleteUser(user)}>Delete</button>
              </div>
            </div>

            {seeFor === user.id && (
              <div className="mt-3 rounded border border-steel-200 bg-steel-50 p-3">
                {seenPassword && seenPassword.id === user.id ? (
                  seenPassword.value ? (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-black uppercase tracking-wide text-workshop-700">{user.fullName || user.username || user.email}&apos;s password</p>
                        <p className="font-mono text-xl font-black text-steel-900">{seenPassword.value}</p>
                      </div>
                      <button type="button" className="rounded bg-workshop-500 px-3 py-2 text-sm font-black text-white" onClick={() => copyText(seenPassword.value ?? "")}>Copy</button>
                    </div>
                  ) : (
                    <p className="text-sm font-bold text-steel-600">
                      No viewable password saved for this user — it was set before this feature. Use <span className="font-black">Reset Password</span> once to set a viewable one.
                    </p>
                  )
                ) : (
                  <form
                    className="flex flex-wrap items-end gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      revealPassword(user);
                    }}
                  >
                    <Label title="Re-enter YOUR admin password to view" icon={<ShieldCheck size={16} />}>
                      <input
                        type="password"
                        className="field"
                        value={adminPw}
                        autoComplete="current-password"
                        onChange={(event) => setAdminPw(event.target.value)}
                        placeholder="Your admin password"
                      />
                    </Label>
                    <button type="submit" disabled={seeBusy || !adminPw} className="touch-target rounded bg-steel-900 px-4 text-sm font-black text-white disabled:bg-steel-300">
                      {seeBusy ? "Checking…" : "Reveal"}
                    </button>
                  </form>
                )}
              </div>
            )}

            {editingId === user.id && (
              <div className="mt-3 grid gap-3 rounded border border-steel-100 bg-steel-50 p-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto_auto] lg:items-end">
                <Label title="Role" icon={<ShieldCheck size={16} />}>
                  <select
                    className="field"
                    value={permDraft.role}
                    onChange={(event) => setPermDraft((current) => ({ ...current, role: event.target.value }))}
                  >
                    {userRoleOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </Label>
                <Label title="Manager Yards" icon={<MapPin size={16} />}>
                  <YardAccessPicker
                    value={permDraft.allowedYards}
                    disabled={permDraft.role !== "supervisor"}
                    onChange={(next) => setPermDraft((current) => ({ ...current, allowedYards: next }))}
                  />
                </Label>
                <Label title="Status" icon={<UserRound size={16} />}>
                  <button
                    type="button"
                    onClick={() => setPermDraft((current) => ({ ...current, active: !current.active }))}
                    className={classNames("field font-black", permDraft.active ? "bg-workshop-100 text-workshop-700" : "bg-steel-200 text-steel-700")}
                  >
                    {permDraft.active ? "Active" : "Inactive"}
                  </button>
                </Label>
                <button
                  type="button"
                  disabled={savingPerms}
                  onClick={() => savePermissions(user)}
                  className="touch-target flex items-center justify-center gap-2 rounded bg-workshop-500 px-4 font-black text-white disabled:bg-steel-300"
                >
                  <Save size={18} />
                  {savingPerms ? "Saving…" : "Save"}
                </button>
              </div>
            )}
          </div>
        ))}
        {users.length === 0 && (
          <div className="rounded border border-steel-100 bg-white p-5 text-center font-bold text-steel-500">No users loaded yet.</div>
        )}
      </div>
    </div>
  );
}
