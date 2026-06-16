"use client";

import {
  BarChart3,
  Building2,
  CalendarDays,
  Camera,
  Check,
  Clock,
  Download,
  Edit2,
  Eye,
  Factory,
  FileSpreadsheet,
  Filter,
  ImagePlus,
  MapPin,
  Minus,
  Moon,
  Plus,
  Save,
  Search,
  ShieldCheck,
  Sun,
  Trash2,
  UserRound,
  X
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
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
  timeOptions
} from "@/lib/data";
import { calculateEntry, currency, getWeekKey, wholeNumber } from "@/lib/payroll";
import type { BreakProfile, CountSheet, CountSheetStatus, DailyEntry, Employee, Location, PalletCategory, PalletType, PayrollSettings, ProductionLine, Role, Shift } from "@/lib/types";

const entryStorageKey = "mgp-daily-entries-v2";
const countSheetStorageKey = "mgp-count-sheets-v1";
const palletStorageKey = "mgp-pallet-types-v2";
const employeeStorageKey = "mgp-employees-v2";
const locationStorageKey = "mgp-locations-v2";
const shiftStorageKey = "mgp-shifts-v2";
const payrollSettingsStorageKey = "mgp-payroll-settings-v1";
const today = new Date().toISOString().slice(0, 10);
const legacyPalletTypeAliases: Record<string, string> = {
  "no-1": "stacker-grade-a-1",
  "no-2": "stacker-grade-b-2"
};

type View = "entry" | "count-sheets" | "production-grid" | "dashboard" | "payroll" | "settings";
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

function isManager(employee?: Employee): boolean {
  return employee?.role === "supervisor";
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
    ...(migratedLegacyId ? { updatedAt: new Date().toISOString(), updatedBy: "Legacy pallet type migration" } : {})
  } as DailyEntry;
}

function sanitizeCountSheetsForStorage(countSheets: CountSheet[]) {
  return countSheets.map((sheet) => ({
    ...sheet,
    photos: sheet.photos.filter((photo) => !photo.url.startsWith("data:")).map((photo) => ({ ...photo }))
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

async function compressImage(file: File) {
  if (!file.type.startsWith("image/")) return file;

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

export default function Home() {
  const [view, setView] = useState<View>("entry");
  const [adminTab, setAdminTab] = useState<AdminTab>("settings");
  const [darkMode, setDarkMode] = useState(false);
  const [entries, setEntries] = useState<DailyEntry[]>([]);
  const [countSheets, setCountSheets] = useState<CountSheet[]>([]);
  const [palletTypes, setPalletTypes] = useState<PalletType[]>(defaultPalletTypes);
  const [employeeList, setEmployeeList] = useState<Employee[]>(defaultEmployees);
  const [locationList, setLocationList] = useState<Location[]>(defaultLocations);
  const [shiftList, setShiftList] = useState<Shift[]>(defaultShifts);
  const [settings, setSettings] = useState<PayrollSettings>(payrollSettings);
  const [form, setForm] = useState<EntryForm>(() => createBlankForm(defaultPalletTypes, defaultEmployees));
  const [saveStatus, setSaveStatus] = useState("Ready");
  const [adminStatus, setAdminStatus] = useState("Spreadsheet-style setup is ready.");
  const [selectedWeek, setSelectedWeek] = useState(getWeekKey(today));
  const [editingEntry, setEditingEntry] = useState<DailyEntry | null>(null);
  const [viewingEntry, setViewingEntry] = useState<DailyEntry | null>(null);
  const [profileEmployeeId, setProfileEmployeeId] = useState<string | null>(null);
  const [entriesLoaded, setEntriesLoaded] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  useEffect(() => {
    const savedEntries = window.localStorage.getItem(entryStorageKey) ?? window.localStorage.getItem("mgp-daily-entries");
    let localEntries: DailyEntry[] = [];
    if (savedEntries) {
      localEntries = (JSON.parse(savedEntries) as DailyEntry[]).map(migrateEntry);
      window.localStorage.setItem(entryStorageKey, JSON.stringify(localEntries));
      setEntries(localEntries);
    }

    Promise.all(
      localEntries.map((entry) =>
        fetch("/api/entries?syncSheets=false", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(entry)
        }).catch(() => undefined)
      )
    )
      .then(() => fetch("/api/entries"))
      .then((response) => response.json())
      .then((result: { entries: DailyEntry[] }) => {
        const merged = new Map<string, DailyEntry>();
        [...localEntries, ...result.entries.map(migrateEntry)].forEach((entry) => merged.set(entry.id, entry));
        setEntries(Array.from(merged.values()).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)));
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
      window.localStorage.setItem(palletStorageKey, JSON.stringify(defaultPalletTypes));
    }

    const savedLocations = window.localStorage.getItem(locationStorageKey);
    const effectiveLocations: Location[] = savedLocations ? JSON.parse(savedLocations) : defaultLocations;
    if (savedLocations) {
      setLocationList(effectiveLocations);
    }

    const savedEmployees = window.localStorage.getItem(employeeStorageKey);
    if (savedEmployees) {
      setEmployeeList(ensureYardManagers(JSON.parse(savedEmployees), effectiveLocations));
    } else {
      setEmployeeList((current) => ensureYardManagers(current, effectiveLocations));
    }

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
    const timer = window.setInterval(loadSharedEntries, 15_000);
    window.addEventListener("focus", loadSharedEntries);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", loadSharedEntries);
    };
  }, [entriesLoaded]);

  useEffect(() => {
    if (entriesLoaded) {
      window.localStorage.setItem(entryStorageKey, JSON.stringify(entries));
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
    window.localStorage.setItem(palletStorageKey, JSON.stringify(palletTypes));
  }, [palletTypes]);

  useEffect(() => {
    window.localStorage.setItem(employeeStorageKey, JSON.stringify(employeeList));
  }, [employeeList]);

  useEffect(() => {
    window.localStorage.setItem(locationStorageKey, JSON.stringify(locationList));
  }, [locationList]);

  useEffect(() => {
    window.localStorage.setItem(shiftStorageKey, JSON.stringify(shiftList));
  }, [shiftList]);

  useEffect(() => {
    window.localStorage.setItem(payrollSettingsStorageKey, JSON.stringify(settings));
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

  const report = useMemo(() => buildReport(entries, palletTypes, employeeList, locationList, settings), [employeeList, entries, locationList, palletTypes, settings]);

  function updateForm<T extends keyof EntryForm>(key: T, value: EntryForm[T]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function handleEmployeeChange(employeeId: string) {
    const employee = employeeList.find((item) => item.id === employeeId);
    setForm((current) => ({
      ...current,
      employeeId,
      shift: employee?.shift ?? current.shift
    }));
  }

  function handleYardChange(locationId: string) {
    setForm((current) => {
      const repairers = activeEmployees.filter((employee) => employee.locationId === locationId && !isManager(employee));
      const managers = activeEmployees.filter((employee) => employee.locationId === locationId && isManager(employee));
      const employeeId = repairers.some((employee) => employee.id === current.employeeId)
        ? current.employeeId
        : repairers[0]?.id ?? "";
      const yardManagerId = managers.some((employee) => employee.id === current.yardManagerId)
        ? current.yardManagerId
        : managers[0]?.id ?? "";
      const selectedRepairer = repairers.find((employee) => employee.id === employeeId);
      return {
        ...current,
        locationId,
        employeeId,
        yardManagerId,
        shift: selectedRepairer?.shift ?? current.shift
      };
    });
  }

  function updateLineQuantity(palletTypeId: string, quantity: number) {
    setForm((current) => ({
      ...current,
      lines: current.lines.map((line) => (line.palletTypeId === palletTypeId ? { ...line, quantity: Math.max(0, Number(quantity) || 0) } : line))
    }));
  }

  async function saveEntry() {
    const cleanEntry: DailyEntry = {
      ...form,
      id: `entry-${Date.now()}`,
      manualHours: Number(form.manualHours),
      lines: form.lines.filter((line) => line.quantity !== 0),
      createdAt: new Date().toISOString()
    };

    setEntries((current) => [cleanEntry, ...current]);
    setForm(createBlankForm(activePalletTypes, employeeList));
    setSaveStatus("Saved locally");

    try {
      const response = await fetch("/api/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cleanEntry)
      });
      const result = await response.json();
      setSaveStatus(result.sheets?.configured ? "Saved to Sheets" : "Saved locally; Sheets not configured");
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

  function createEmployee(employee: Omit<Employee, "id">) {
    setEmployeeList((current) => [...current, { ...employee, id: `employee-${Date.now()}` }]);
    setAdminStatus("Repairer saved locally.");
  }

  function updateEmployee(id: string, patch: Partial<Employee>) {
    setEmployeeList((current) => current.map((employee) => (employee.id === id ? { ...employee, ...patch } : employee)));
    setAdminStatus("Repairer updated locally.");
  }

  function deleteEmployee(id: string) {
    setEmployeeList((current) => current.filter((item) => item.id !== id));
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
      "Total Pay"
    ];
    const rows = filteredEntries.flatMap((entry) => {
      const employee = employeeList.find((item) => item.id === entry.employeeId)?.name ?? entry.employeeId;
      const location = locationList.find((item) => item.id === entry.locationId)?.name ?? entry.locationId;
      const calc = calculateEntry(entry, palletTypes, settings);

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
          calc.totalPay.toFixed(2)
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

  return (
    <main className={classNames("min-h-screen pb-24 transition-colors", darkMode ? "bg-steel-900/[0.95] text-white" : "bg-steel-50/[0.88] text-steel-900")}>
      <header className={classNames("sticky top-0 z-20 border-b backdrop-blur", darkMode ? "border-white/10 bg-steel-900/[0.92]" : "border-steel-100 bg-white/[0.92]")}>
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <img src="/logo.svg" alt="Manufacturing Green Products" className="h-12 w-12 shrink-0 rounded-full sm:h-14 sm:w-14" />
            <div className="min-w-0">
              <p className="truncate text-xs font-bold uppercase tracking-wide text-workshop-700">MGP</p>
              <h1 className="truncate text-lg font-black sm:text-2xl">Pallet Repair Tracking</h1>
            </div>
          </div>
          <button
            type="button"
            aria-label="Toggle dark mode"
            className={classNames("touch-target flex w-12 items-center justify-center rounded border", darkMode ? "border-white/20 bg-white/10" : "border-steel-100 bg-white")}
            onClick={() => setDarkMode((value) => !value)}
          >
            {darkMode ? <Sun size={20} /> : <Moon size={20} />}
          </button>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-4 px-4 py-4">
        <nav className={classNames("no-scrollbar flex gap-2 overflow-x-auto rounded border p-2", darkMode ? "border-white/10 bg-white/[0.08]" : "border-steel-100 bg-white/90")}>
          <NavButton icon={<Plus size={19} />} label="Entry" active={view === "entry"} onClick={() => setView("entry")} />
          <NavButton icon={<Camera size={19} />} label="Count Sheets" active={view === "count-sheets"} onClick={() => setView("count-sheets")} />
          <NavButton icon={<FileSpreadsheet size={19} />} label="Production Grid" active={view === "production-grid"} onClick={() => setView("production-grid")} />
          <NavButton icon={<BarChart3 size={19} />} label="Dashboard" active={view === "dashboard"} onClick={() => setView("dashboard")} />
          <NavButton icon={<FileSpreadsheet size={19} />} label="Payroll" active={view === "payroll"} onClick={() => setView("payroll")} />
          <NavButton icon={<ShieldCheck size={19} />} label="Admin" active={view === "settings"} onClick={() => setView("settings")} />
        </nav>

        <section className={classNames("rounded border p-4 shadow-panel", darkMode ? "border-white/10 bg-steel-800/[0.94]" : "border-steel-100 bg-white/95")}>
          {view === "entry" && (
            <ProductionEntry
              darkMode={darkMode}
              form={form}
              saveStatus={saveStatus}
              selectedEmployee={selectedEmployee}
              employees={activeEmployees}
              locations={locationList}
              shifts={shiftList}
              palletTypes={activePalletTypes}
              calculation={currentCalculation}
              onEmployeeChange={handleEmployeeChange}
              onYardChange={handleYardChange}
              onFormChange={updateForm}
              onQuantityChange={updateLineQuantity}
              onSave={saveEntry}
            />
          )}
          {view === "count-sheets" && (
            <CountSheetsModule
              countSheets={countSheets}
              entries={entries}
              locations={locationList}
              shifts={shiftList}
              onCreate={createCountSheet}
              onUpdate={updateCountSheet}
              onDelete={deleteCountSheet}
            />
          )}
          {view === "production-grid" && (
            <ProductionGrid
              entries={entries}
              countSheets={countSheets}
              employees={employeeList}
              locations={locationList}
              palletTypes={palletTypes}
              settings={settings}
              selectedWeek={selectedWeek}
              onWeekChange={setSelectedWeek}
              onSelectEmployee={setProfileEmployeeId}
              onEditEntry={setEditingEntry}
              onViewEntry={setViewingEntry}
              onDeleteEntry={deleteSavedEntry}
            />
          )}
          {view === "dashboard" && <Dashboard report={report} settings={settings} darkMode={darkMode} countSheets={countSheets} entries={entries} locations={locationList} shifts={shiftList} onSelectEmployee={setProfileEmployeeId} />}
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
              darkMode={darkMode}
              onEditEntry={setEditingEntry}
              onViewEntry={setViewingEntry}
              onDeleteEntry={deleteSavedEntry}
              onSelectEmployee={setProfileEmployeeId}
            />
          )}
          {view === "settings" && (
            <Settings
              darkMode={darkMode}
              status={adminStatus}
              activeTab={adminTab}
              setActiveTab={setAdminTab}
              palletTypes={palletTypes}
              employees={employeeList}
              locations={locationList}
              shifts={shiftList}
              settings={settings}
              onCreatePallet={createPalletType}
              onUpdatePallet={updatePalletType}
              onDeletePallet={deletePalletType}
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
    </main>
  );
}

function ProductionEntry({
  darkMode,
  form,
  saveStatus,
  selectedEmployee,
  employees,
  locations,
  shifts,
  palletTypes,
  calculation,
  onEmployeeChange,
  onYardChange,
  onFormChange,
  onQuantityChange,
  onSave
}: {
  darkMode: boolean;
  form: EntryForm;
  saveStatus: string;
  selectedEmployee?: Employee;
  employees: Employee[];
  locations: Location[];
  shifts: Shift[];
  palletTypes: PalletType[];
  calculation: ReturnType<typeof calculateEntry>;
  onEmployeeChange: (employeeId: string) => void;
  onYardChange: (locationId: string) => void;
  onFormChange: <T extends keyof EntryForm>(key: T, value: EntryForm[T]) => void;
  onQuantityChange: (palletTypeId: string, quantity: number) => void;
  onSave: () => void;
}) {
  const yardRepairers = employees.filter((employee) => employee.locationId === form.locationId && employee.role !== "supervisor");
  const yardManagers = employees.filter((employee) => employee.locationId === form.locationId && employee.role === "supervisor");

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Avatar employee={selectedEmployee} size="lg" />
          <div>
            <h2 className="text-2xl font-black">Daily Production Grid</h2>
            <p className={classNames("text-sm", darkMode ? "text-steel-100" : "text-steel-500")}>{saveStatus}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric label="Pallets" value={wholeNumber(calculation.quantity)} />
          <Metric label="Piece Pay" value={currency(calculation.pieceEarnings)} />
          <Metric label="Make-up" value={currency(calculation.additionalOwed)} />
          <Metric label="Total" value={currency(calculation.totalPay)} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
        <Label title="Date" icon={<CalendarDays size={17} />}>
          <input className="field" type="date" value={form.date} onChange={(event) => onFormChange("date", event.target.value)} />
        </Label>
        <Label title="Yard" icon={<MapPin size={17} />}>
          <select className="field" value={form.locationId} onChange={(event) => onYardChange(event.target.value)}>
            {locations.filter((location) => location.active).map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </Label>
        <Label title="Yard Manager" icon={<ShieldCheck size={17} />}>
          <select className="field" value={form.yardManagerId ?? ""} onChange={(event) => onFormChange("yardManagerId", event.target.value)}>
            <option value="">— No manager —</option>
            {yardManagers.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.name}
              </option>
            ))}
          </select>
        </Label>
        <Label title="Repairer" icon={<UserRound size={17} />}>
          <select className="field" value={form.employeeId} onChange={(event) => onEmployeeChange(event.target.value)}>
            {yardRepairers.length === 0 && <option value="">No repairers in this yard</option>}
            {yardRepairers.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.name}
              </option>
            ))}
          </select>
        </Label>
      </div>

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

      <div className="overflow-hidden rounded border border-steel-100 bg-white text-steel-900">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-steel-900 text-white">
              <tr>
                <th className="p-3">Category</th>
                <th className="p-3">Pallet Description</th>
                <th className="p-3">Rate</th>
                <th className="p-3">Quantity</th>
                <th className="p-3">Total Earned</th>
              </tr>
            </thead>
            <tbody>
              {palletTypes.map((pallet) => {
                const line = form.lines.find((item) => item.palletTypeId === pallet.id);
                const quantity = line?.quantity ?? 0;
                const earned = quantity * pallet.rate;

                return (
                  <tr key={pallet.id} className="border-t border-steel-100">
                    <td className="p-3 font-black">{pallet.category}</td>
                    <td className="p-3">
                      <span className="block font-black">{pallet.code}</span>
                      <span className="text-steel-500">{pallet.description}</span>
                    </td>
                    <td className={classNames("p-3 font-black", pallet.rate < 0 ? "text-red-700" : "text-workshop-700")}>{currency(pallet.rate)}</td>
                    <td className="p-3">
                      <div className="grid grid-cols-[44px_88px_44px] gap-2">
                        <button type="button" className="touch-target flex items-center justify-center rounded bg-steel-800 text-white" onClick={() => onQuantityChange(pallet.id, quantity - 1)}>
                          <Minus size={18} />
                        </button>
                        <input className="field text-center font-black" inputMode="numeric" type="number" min="0" value={quantity} onChange={(event) => onQuantityChange(pallet.id, Number(event.target.value))} />
                        <button type="button" className="touch-target flex items-center justify-center rounded bg-safety-400 text-steel-900" onClick={() => onQuantityChange(pallet.id, quantity + 1)}>
                          <Plus size={18} />
                        </button>
                      </div>
                    </td>
                    <td className={classNames("p-3 text-lg font-black", earned < 0 ? "text-red-700" : "text-steel-900")}>{currency(earned)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

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

      <Label title="Notes" icon={<FileSpreadsheet size={17} />}>
        <textarea className="field min-h-20 resize-none" value={form.notes} onChange={(event) => onFormChange("notes", event.target.value)} placeholder="Supervisor notes, trailer, customer, or repair issues" />
      </Label>

      <button type="button" className="touch-target flex items-center justify-center gap-2 rounded bg-workshop-500 px-4 py-3 text-lg font-black text-white shadow-panel" onClick={onSave}>
        <Save size={22} />
        Save Daily Grid
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
  const [statusMessage, setStatusMessage] = useState("Ready for count sheet photos.");
  const [isSaving, setIsSaving] = useState(false);
  const [selectedSheetId, setSelectedSheetId] = useState<string | null>(null);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(0);
  const [search, setSearch] = useState("");
  const [singleDateFilter, setSingleDateFilter] = useState("");
  const [weekFilter, setWeekFilter] = useState("");
  const [fromDateFilter, setFromDateFilter] = useState("");
  const [toDateFilter, setToDateFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("all");
  const [shiftFilter, setShiftFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"All" | CountSheetStatus>("All");
  const [uploadedByFilter, setUploadedByFilter] = useState("");
  const [sortMode, setSortMode] = useState<"newest" | "oldest" | "date-asc" | "date-desc">("newest");

  const filteredSheets = countSheets
    .filter((sheet) => {
      const location = locations.find((item) => item.id === sheet.locationId)?.name ?? sheet.locationId;
      const query = search.toLowerCase();
      if (singleDateFilter && sheet.date !== singleDateFilter) return false;
      if (weekFilter && getWeekKey(sheet.date) !== getWeekKey(weekFilter)) return false;
      if (fromDateFilter && sheet.date < fromDateFilter) return false;
      if (toDateFilter && sheet.date > toDateFilter) return false;
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

  function handleFiles(selected: FileList | null) {
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
    setSingleDateFilter("");
    setWeekFilter("");
    setFromDateFilter("");
    setToDateFilter("");
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
              <input className="field" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
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
          {files.length > 0 && (
            <div className="rounded border border-steel-100 bg-steel-50 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <strong>{files.length} photo{files.length === 1 ? "" : "s"} ready</strong>
                <button type="button" className="rounded bg-steel-200 px-3 py-1 text-sm font-black" onClick={() => setFiles([])}>Clear</button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {files.slice(0, 6).map((file) => (
                  <div key={`${file.name}-${file.size}`} className="truncate rounded bg-white p-2 text-xs font-bold">{file.name}</div>
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
            <Label title="Single Date" icon={<CalendarDays size={17} />}>
              <input className="field" type="date" value={singleDateFilter} onChange={(event) => setSingleDateFilter(event.target.value)} />
            </Label>
            <Label title="Week" icon={<CalendarDays size={17} />}>
              <input className="field" type="date" value={weekFilter} onChange={(event) => setWeekFilter(event.target.value)} />
            </Label>
            <Label title="From" icon={<CalendarDays size={17} />}>
              <input className="field" type="date" value={fromDateFilter} onChange={(event) => setFromDateFilter(event.target.value)} />
            </Label>
            <Label title="To" icon={<CalendarDays size={17} />}>
              <input className="field" type="date" value={toDateFilter} onChange={(event) => setToDateFilter(event.target.value)} />
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

function Dashboard({
  report,
  settings,
  darkMode,
  countSheets,
  entries,
  locations,
  shifts,
  onSelectEmployee
}: {
  report: ReturnType<typeof buildReport>;
  settings: PayrollSettings;
  darkMode: boolean;
  countSheets: CountSheet[];
  entries: DailyEntry[];
  locations: Location[];
  shifts: Shift[];
  onSelectEmployee: (employeeId: string) => void;
}) {
  const countSheetStats = buildCountSheetStats(countSheets, entries, locations, shifts);

  return (
    <div className="grid gap-5">
      <div>
        <h2 className="text-2xl font-black">Dashboard</h2>
        <p className={classNames("text-sm", darkMode ? "text-steel-100" : "text-steel-500")}>Daily and weekly totals from the production grid.</p>
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
              <Bar dataKey="quantity" fill="#2d7d71" name="Quantity" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <Leaderboard rows={report.byEmployee} onSelectEmployee={onSelectEmployee} />
      </div>
      <BreakdownTable title="Weekly Totals by Pallet Type" rows={report.byPallet} />
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
        <button type="button" className="touch-target flex items-center gap-2 rounded bg-steel-900 px-4 py-2 font-black text-white" onClick={() => exportCsv(filteredEntries)}>
          <Download size={19} />
          Export CSV
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-5">
        <FilterSelect label="Employee" value={employeeFilter} onChange={setEmployeeFilter} options={[{ id: "all", name: "All Employees" }, ...employees.map((employee) => ({ id: employee.id, name: employee.name }))]} />
        <FilterSelect label="Location" value={locationFilter} onChange={setLocationFilter} options={[{ id: "all", name: "All Locations" }, ...locations.map((location) => ({ id: location.id, name: location.name }))]} />
        <FilterSelect label="Shift" value={shiftFilter} onChange={setShiftFilter} options={[{ id: "all", name: "All Shifts" }, ...shifts.map((shift) => ({ id: shift, name: shift }))]} />
        <Label title="Start" icon={<CalendarDays size={17} />}>
          <input className="field" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
        </Label>
        <Label title="End" icon={<CalendarDays size={17} />}>
          <input className="field" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
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
      <input className="field" type="date" value={selectedWeek} onChange={(event) => onWeekChange(getWeekKey(event.target.value))} />
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
  for (const line of entry.lines) {
    const resolvedId = getResolvedPalletTypeId(palletTypes, line.palletTypeId);
    entryLines.set(resolvedId, (entryLines.get(resolvedId) ?? 0) + line.quantity);
  }
  const lineIds = new Set([...palletTypes.map((pallet) => pallet.id), ...entryLines.keys()]);

  return {
    date: entry.date,
    employeeId: entry.employeeId,
    locationId: entry.locationId,
    shift: entry.shift,
    lines: Array.from(lineIds).map((palletTypeId) => ({
      palletTypeId,
      quantity: entryLines.get(palletTypeId) ?? 0
    })),
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
  onDeleteEntry
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
}) {
  const weekDays = getWeekDays(selectedWeek);
  const weekEntries = entries.filter((entry) => weekDays.includes(entry.date));
  const activePallets = palletTypes.filter((pallet) => pallet.active || weekEntries.some((entry) => entry.lines.some((line) => line.palletTypeId === pallet.id)));
  const weekReport = buildReport(weekEntries, palletTypes, employees, locations, settings);

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-black">Production Grid</h2>
          <p className="text-sm text-steel-500">Weekly spreadsheet view by repairer, pallet type, day, and dollars.</p>
        </div>
        <WeekControls selectedWeek={selectedWeek} onWeekChange={onWeekChange} />
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
                      <tr key={pallet.id} className="border-t border-steel-100">
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
      return b.date.localeCompare(a.date);
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
                  <tr key={entry.id} className="border-t border-steel-100">
                    <td className="p-3 font-bold">
                      <span className="block">{entry.date}</span>
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
                        <button
                          type="button"
                          className="inline-flex items-center gap-1.5 rounded bg-workshop-100 px-2 py-1 text-xs font-black text-workshop-700"
                          onClick={() => {
                            setViewerSheets(linkedSheets);
                            setViewerPhotoIndex(0);
                          }}
                        >
                          <Camera size={15} />
                          {linkedSheets.length} attached
                        </button>
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
  employees,
  locations,
  shifts,
  settings,
  onCreatePallet,
  onUpdatePallet,
  onDeletePallet,
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
  employees: Employee[];
  locations: Location[];
  shifts: Shift[];
  settings: PayrollSettings;
  onCreatePallet: (palletType: Omit<PalletType, "id">) => void | Promise<void>;
  onUpdatePallet: (id: string, patch: Partial<PalletType>) => void | Promise<void>;
  onDeletePallet: (id: string) => void | Promise<void>;
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
      {activeTab === "pallets" && <PalletAdmin palletTypes={palletTypes} onCreate={onCreatePallet} onUpdate={onUpdatePallet} onDelete={onDeletePallet} />}
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
  onCreate,
  onUpdate,
  onDelete
}: {
  palletTypes: PalletType[];
  onCreate: (palletType: Omit<PalletType, "id">) => void | Promise<void>;
  onUpdate: (id: string, patch: Partial<PalletType>) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<"All" | PalletCategory>("All");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Omit<PalletType, "id">>(emptyPallet);
  const [editDraft, setEditDraft] = useState<PalletType | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("Ready.");
  const [error, setError] = useState("");

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
                <tr key={pallet.id} className="border-t border-steel-100">
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
  const visibleEmployees = yardFilter === "all" ? employees : employees.filter((employee) => employee.locationId === yardFilter);
  const sortedEmployees = [...visibleEmployees].sort((a, b) => {
    const byYard = yardName(a.locationId).localeCompare(yardName(b.locationId));
    if (byYard !== 0) return byYard;
    const managerRank = (employee: Employee) => (employee.role === "supervisor" ? 0 : 1);
    if (managerRank(a) !== managerRank(b)) return managerRank(a) - managerRank(b);
    return a.name.localeCompare(b.name);
  });

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
            <input className="field" type="file" accept="image/*" onChange={(event) => handlePhoto(event.target.files?.[0])} />
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
            <option value="all">All Yards</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </Label>
        <p className="pb-2 text-sm font-bold text-steel-500">
          Showing {sortedEmployees.length} {sortedEmployees.length === 1 ? "person" : "people"}
          {yardFilter === "all" ? " across all yards" : ` in ${yardName(yardFilter)}`}.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {sortedEmployees.map((employee) => (
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
                <input className="field" type="file" accept="image/*" onChange={(event) => handlePhoto(event.target.files?.[0], "edit")} />
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
        ? current.lines.map((line) => (line.palletTypeId === palletTypeId ? { ...line, quantity: Math.max(0, Number(quantity) || 0) } : line))
        : [...current.lines, { palletTypeId, quantity: Math.max(0, Number(quantity) || 0) }];
      return { ...current, lines };
    });
  }

  function save() {
    onSave({
      ...entry,
      ...draft,
      manualHours: Number(draft.manualHours),
      lines: draft.lines.filter((line) => line.quantity !== 0)
    });
  }

  return (
    <Modal title={readOnly ? "View Production Entry" : "Edit Production Entry"} onClose={onClose}>
      <div className="grid gap-4">
        <div className="grid gap-3 md:grid-cols-4">
          <Label title="Date" icon={<CalendarDays size={17} />}>
            <input disabled={readOnly} className="field" type="date" value={draft.date} onChange={(event) => updateDraft("date", event.target.value)} />
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
                  const quantity = draft.lines.find((line) => line.palletTypeId === pallet.id)?.quantity ?? 0;
                  return (
                    <tr key={pallet.id} className="border-t border-steel-100">
                      <td className="p-3 font-black">{pallet.category}</td>
                      <td className="p-3"><strong>{pallet.code}</strong><span className="block text-steel-500">{pallet.description}</span></td>
                      <td className="p-3">{currency(pallet.rate)}</td>
                      <td className="p-3">
                        <input disabled={readOnly} className="field max-w-28 text-center font-black" type="number" min="0" value={quantity} onChange={(event) => updateQuantity(pallet.id, Number(event.target.value))} />
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
              <tr key={row.employee.id} className="border-t border-steel-100">
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
              <tr key={row.id ?? row.palletTypeId ?? `${row.label}-${row.category}-${index}`} className="border-t border-steel-100">
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
  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-steel-900/70 p-0 sm:place-items-center sm:p-4">
      <div className="max-h-[92vh] w-full overflow-y-auto rounded-t bg-white p-4 text-steel-900 shadow-panel sm:max-w-2xl sm:rounded">
        <div className="mb-4 flex items-center justify-between gap-3 border-b border-steel-100 pb-3">
          <h3 className="text-xl font-black">{title}</h3>
          <button type="button" aria-label="Close edit modal" className="touch-target flex w-12 items-center justify-center rounded bg-steel-100 text-steel-900" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        {children}
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
