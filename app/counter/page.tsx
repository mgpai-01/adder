"use client";

import { Camera, CheckCircle2, CloudOff, Factory, ImagePlus, RefreshCw, Save, Search, UserRound } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import AuthGate from "@/components/AuthGate";
import DropZone from "@/components/DropZone";
import { defaultPalletTypes, employees as defaultEmployees, shifts } from "@/lib/data";
import type { DailyEntry, Employee, Location, PalletType, ProductionLine, Shift } from "@/lib/types";

type CounterLocation = Pick<Location, "id" | "name">;

type PendingSave = {
  entry: DailyEntry;
  method?: "POST" | "PATCH";
  queuedAt: string;
};

const employeeStorageKey = "mgp-employees-v2";
const locationStorageKey = "mgp-locations-v2";
const palletStorageKey = "mgp-pallet-types-v2";
const pendingStorageKey = "mgp-counter-pending-entries-v1";
const quickAmounts = [5, 10, 25, 50, 100];

const fallbackLocations: CounterLocation[] = [
  { id: "fontana", name: "Fontana" },
  { id: "citrus", name: "Citrus" },
  { id: "fedex", name: "FedEx" },
  { id: "drivers", name: "Drivers" },
  { id: "security", name: "Security" }
];

function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function readLocalArray<T>(key: string, fallback: T[]): T[] {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : fallback;
  } catch {
    return fallback;
  }
}

function readPendingSaves() {
  return readLocalArray<PendingSave>(pendingStorageKey, []);
}

function writePendingSaves(items: PendingSave[]) {
  window.localStorage.setItem(pendingStorageKey, JSON.stringify(items));
}

function quantityForEntry(entry: DailyEntry) {
  return entry.lines.reduce((sum, line) => sum + Number(line.quantity || 0), 0);
}

function mergeLines(lines: ProductionLine[], palletTypeId: string, addQuantity: number) {
  const totals = new Map<string, number>();
  for (const line of lines) {
    totals.set(line.palletTypeId, (totals.get(line.palletTypeId) ?? 0) + Number(line.quantity || 0));
  }
  totals.set(palletTypeId, Math.max(0, (totals.get(palletTypeId) ?? 0) + addQuantity));
  return Array.from(totals, ([id, quantity]) => ({ palletTypeId: id, quantity })).filter((line) => line.quantity > 0);
}

function replaceCounterLines(entry: DailyEntry, quantities: Record<string, number>, palletTypes: PalletType[]) {
  const counterIds = new Set(palletTypes.map((pallet) => pallet.id));
  const otherLines = entry.lines.filter((line) => !counterIds.has(line.palletTypeId));
  const adjustedLines = palletTypes
    .map((pallet) => ({ palletTypeId: pallet.id, quantity: Math.max(0, Number(quantities[pallet.id] || 0)) }))
    .filter((line) => line.quantity > 0);
  return [...otherLines, ...adjustedLines];
}

function palletLabel(pallet: PalletType) {
  return `${pallet.code} ${pallet.description}`.trim();
}

function createCounterEntry(employee: Employee, locationId: string, shift: Shift, palletTypeId: string, quantity: number, date: string): DailyEntry {
  return {
    id: `counter-${Date.now()}`,
    date,
    employeeId: employee.id,
    locationId,
    shift,
    lines: [{ palletTypeId, quantity }],
    manualHours: 0,
    breakProfile: "standard",
    notes: "Counter app entry",
    createdAt: new Date().toISOString(),
    updatedBy: "Counter"
  };
}

function upsertEntry(entries: DailyEntry[], entry: DailyEntry) {
  const index = entries.findIndex((item) => item.id === entry.id);
  if (index === -1) return [entry, ...entries];
  const next = [...entries];
  next[index] = entry;
  return next;
}

export default function CounterPage() {
  const [employees, setEmployees] = useState<Employee[]>(defaultEmployees);
  const [locations, setLocations] = useState<CounterLocation[]>(fallbackLocations);
  const [palletTypes, setPalletTypes] = useState<PalletType[]>(defaultPalletTypes);
  const [palletSource, setPalletSource] = useState("Default pallet list");
  const [entries, setEntries] = useState<DailyEntry[]>([]);
  // Always mirrors the latest entries so saves and the 15s refresh can build on
  // what's actually on screen (including counts not yet synced) instead of a
  // stale snapshot.
  const entriesRef = useRef<DailyEntry[]>([]);
  entriesRef.current = entries;
  const [today, setToday] = useState("");
  const [search, setSearch] = useState("");
  const [locationFilter, setLocationFilter] = useState("all");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(defaultEmployees[0]?.id ?? "");
  const [selectedLocationId, setSelectedLocationId] = useState(defaultEmployees[0]?.locationId ?? "fontana");
  const [selectedShift, setSelectedShift] = useState<Shift>(defaultEmployees[0]?.shift ?? "AM");
  const [selectedPalletId, setSelectedPalletId] = useState(defaultPalletTypes[0]?.id ?? "");
  const [customQuantity, setCustomQuantity] = useState("");
  const [uploadedBy, setUploadedBy] = useState("Counter");
  const [photoNotes, setPhotoNotes] = useState("");
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [status, setStatus] = useState("Ready");
  const [photoStatus, setPhotoStatus] = useState("No photos selected");
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingPhotos, setIsUploadingPhotos] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [editMode, setEditMode] = useState(false);
  const [editQuantities, setEditQuantities] = useState<Record<string, number>>({});

  const activeEmployees = useMemo(() => employees.filter((employee) => employee.active !== false), [employees]);
  const counterPalletTypes = useMemo(() => palletTypes.filter((pallet) => pallet.active), [palletTypes]);
  const selectedEmployee = activeEmployees.find((employee) => employee.id === selectedEmployeeId) ?? activeEmployees[0];

  const todayEntries = useMemo(() => (today ? entries.filter((entry) => entry.date === today) : []), [entries, today]);
  const selectedEntries = useMemo(() => {
    if (!selectedEmployee) return [];
    return todayEntries.filter((entry) => entry.employeeId === selectedEmployee.id && entry.locationId === selectedLocationId && entry.shift === selectedShift);
  }, [selectedEmployee, selectedLocationId, selectedShift, todayEntries]);

  const selectedBreakdown = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const pallet of counterPalletTypes) totals[pallet.id] = 0;
    for (const entry of selectedEntries) {
      for (const line of entry.lines) {
        if (line.palletTypeId in totals) totals[line.palletTypeId] += Number(line.quantity || 0);
      }
    }
    return totals;
  }, [counterPalletTypes, selectedEntries]);

  const selectedTotal = Object.values(selectedBreakdown).reduce((sum, quantity) => sum + quantity, 0);
  const todayTotal = todayEntries.reduce((sum, entry) => sum + quantityForEntry(entry), 0);
  const activeRepairerCount = new Set(todayEntries.map((entry) => entry.employeeId)).size;
  const repairerTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const entry of todayEntries) {
      totals.set(entry.employeeId, (totals.get(entry.employeeId) ?? 0) + quantityForEntry(entry));
    }
    return activeEmployees
      .map((employee) => ({ employee, quantity: totals.get(employee.id) ?? 0 }))
      .sort((a, b) => b.quantity - a.quantity || a.employee.name.localeCompare(b.employee.name));
  }, [activeEmployees, todayEntries]);
  const topRepairer = repairerTotals.find((row) => row.quantity > 0);

  const visibleRepairers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return activeEmployees
      .filter((employee) => locationFilter === "all" || employee.locationId === locationFilter)
      .filter((employee) => !query || employee.name.toLowerCase().includes(query))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [activeEmployees, locationFilter, search]);

  useEffect(() => {
    setToday(formatLocalDate(new Date()));
    const localEmployees = readLocalArray<Employee>(employeeStorageKey, defaultEmployees);
    const localLocations = readLocalArray<Location>(locationStorageKey, fallbackLocations as Location[]);
    const normalizedLocations = [...fallbackLocations];
    for (const location of localLocations) {
      if (!normalizedLocations.some((item) => item.id === location.id)) {
        normalizedLocations.push({ id: location.id, name: location.name });
      }
    }
    setEmployees(localEmployees);
    setLocations(normalizedLocations);
    setPendingCount(readPendingSaves().length);
  }, []);

  useEffect(() => {
    const savedPalletTypes = readLocalArray<PalletType>(palletStorageKey, defaultPalletTypes);
    if (savedPalletTypes.length > 0) {
      setPalletTypes(savedPalletTypes);
      setPalletSource("Main Entry local pallet list");
    }

    fetch("/api/pallet-types", { cache: "no-store" })
      .then((response) => response.json())
      .then((result: { configured: boolean; storage?: string; palletTypes: PalletType[] }) => {
        if (result.palletTypes.length > 0) {
          setPalletTypes(result.palletTypes);
          setPalletSource(result.configured ? "Main Entry database pallet list" : "Main Entry local server pallet list");
          return;
        }
        setPalletSource(savedPalletTypes.length > 0 ? "Main Entry local pallet list" : "Default pallet list");
      })
      .catch(() => setPalletSource(savedPalletTypes.length > 0 ? "Main Entry local pallet list" : "Default pallet list"));
  }, []);

  useEffect(() => {
    if (!selectedEmployee) return;
    setSelectedEmployeeId(selectedEmployee.id);
    setSelectedLocationId(selectedEmployee.locationId);
    setSelectedShift(selectedEmployee.shift);
  }, [selectedEmployee?.id]);

  useEffect(() => {
    if (counterPalletTypes.length === 0) {
      setSelectedPalletId("");
      return;
    }
    if (!counterPalletTypes.some((pallet) => pallet.id === selectedPalletId)) {
      setSelectedPalletId(counterPalletTypes[0].id);
    }
  }, [counterPalletTypes, selectedPalletId]);

  // Merge a fresh cloud pull with what's on screen instead of replacing it, so a
  // background refresh never wipes a count that hasn't reached the server yet.
  // Keep a local entry the cloud lacks only while it's still queued to sync (so
  // we don't resurrect entries an admin deleted), and keep the newer copy per id.
  function mergeCloudEntries(cloudEntries: DailyEntry[]) {
    const cloudById = new Map(cloudEntries.map((entry) => [entry.id, entry]));
    const pendingIds = new Set(readPendingSaves().map((item) => item.entry.id));
    const recency = (entry: DailyEntry) => entry.updatedAt ?? entry.createdAt ?? "";
    const merged = new Map(cloudById);
    for (const local of entriesRef.current) {
      const cloud = cloudById.get(local.id);
      if (!cloud) {
        if (pendingIds.has(local.id)) merged.set(local.id, local);
      } else if (recency(local) > recency(cloud)) {
        merged.set(local.id, local);
      }
    }
    return Array.from(merged.values());
  }

  async function loadEntries() {
    const response = await fetch("/api/entries", { cache: "no-store" });
    const result = (await response.json()) as { entries: DailyEntry[] };
    setEntries(mergeCloudEntries(result.entries ?? []));
  }

  useEffect(() => {
    loadEntries().catch(() => setStatus("Offline mode: saved counts will sync later"));
    const timer = window.setInterval(() => loadEntries().catch(() => undefined), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  // Seed the "Edit Today" boxes from the current totals — but NOT while the
  // worker is mid-edit, or a 15s refresh would silently revert what they typed.
  useEffect(() => {
    if (!editMode) setEditQuantities(selectedBreakdown);
  }, [selectedBreakdown, editMode]);

  async function syncPending() {
    const pending = readPendingSaves();
    if (pending.length === 0) {
      setPendingCount(0);
      return;
    }

    const synced: PendingSave[] = [];
    for (const item of pending) {
      try {
        await persistEntry(item.entry, item.method ?? "POST");
        synced.push(item);
      } catch {
        // Leave it queued.
      }
    }
    // Re-read the queue so any count queued WHILE we were syncing is preserved,
    // and drop only the exact versions we just synced (match id + queuedAt) so a
    // newer re-queued update for the same entry isn't thrown away.
    const syncedKeys = new Set(synced.map((item) => `${item.entry.id}|${item.queuedAt}`));
    const remaining = readPendingSaves().filter((item) => !syncedKeys.has(`${item.entry.id}|${item.queuedAt}`));
    writePendingSaves(remaining);
    setPendingCount(remaining.length);
    if (remaining.length === 0) {
      setStatus("Offline counts synced");
      await loadEntries().catch(() => undefined);
    }
  }

  useEffect(() => {
    const handleOnline = () => syncPending().catch(() => undefined);
    window.addEventListener("online", handleOnline);
    syncPending().catch(() => undefined);
    return () => window.removeEventListener("online", handleOnline);
  }, []);

  async function persistEntry(entry: DailyEntry, method: "POST" | "PATCH") {
    const endpoint = method === "PATCH" ? `/api/entries/${entry.id}` : "/api/entries";
    const response = await fetch(endpoint, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry)
    });
    if (!response.ok) throw new Error("Unable to save count");
    const result = (await response.json()) as { ok?: boolean; entry?: DailyEntry };
    if (!result.ok || result.entry?.id !== entry.id) throw new Error("Count was not confirmed by server");
    const verifyResponse = await fetch("/api/entries", { cache: "no-store" });
    if (!verifyResponse.ok) throw new Error("Unable to verify saved count");
    const verifyResult = (await verifyResponse.json()) as { entries: DailyEntry[] };
    const savedEntry = verifyResult.entries.find((item) => item.id === entry.id);
    if (!savedEntry) throw new Error("Saved count was not found in shared production entries");
    // Merge (don't replace) so other still-unsynced counts aren't wiped.
    setEntries(mergeCloudEntries(verifyResult.entries ?? []));
  }

  function queueEntry(entry: DailyEntry, method: "POST" | "PATCH") {
    const pending = readPendingSaves();
    writePendingSaves([...pending.filter((item) => item.entry.id !== entry.id), { entry, method, queuedAt: new Date().toISOString() }]);
    setPendingCount(readPendingSaves().length);
  }

  async function saveQuantity(quantity: number) {
    if (!selectedEmployee || !selectedPalletId || !today || quantity <= 0) return;
    setIsSaving(true);
    // Find the day's entry in the freshest list (entriesRef), not a render
    // snapshot, and advance the ref synchronously — so a rapid second tap adds
    // onto the first (100) instead of both reading 0 and one overwriting the
    // other (50 lost).
    const employeeId = selectedEmployee.id;
    const primary = entriesRef.current.find(
      (entry) => entry.date === today && entry.employeeId === employeeId && entry.locationId === selectedLocationId && entry.shift === selectedShift
    );
    const method = primary ? "PATCH" : "POST";
    const baseEntry = primary
      ? {
          ...primary,
          lines: mergeLines(primary.lines, selectedPalletId, quantity),
          updatedAt: new Date().toISOString(),
          updatedBy: "Counter"
        }
      : createCounterEntry(selectedEmployee, selectedLocationId, selectedShift, selectedPalletId, quantity, today);

    const nextEntries = upsertEntry(entriesRef.current, baseEntry);
    entriesRef.current = nextEntries;
    setEntries(nextEntries);
    setStatus(`Saved +${quantity}`);

    try {
      await persistEntry(baseEntry, method);
      setStatus(`Saved +${quantity} and live board updated`);
    } catch {
      queueEntry(baseEntry, method);
      setStatus("Not yet on live board: saved on this device and queued for sync");
    } finally {
      setIsSaving(false);
      setCustomQuantity("");
    }
  }

  async function saveAdjustedTotals() {
    if (!selectedEmployee || !today) return;
    setIsSaving(true);
    const blankEntry = createCounterEntry(selectedEmployee, selectedLocationId, selectedShift, counterPalletTypes[0]?.id ?? "unknown", 0, today);
    // Use the freshest copy of the day's entry so a concurrent +N or refresh
    // isn't overwritten by a stale snapshot.
    const employeeId = selectedEmployee.id;
    const primary = entriesRef.current.find(
      (entry) => entry.date === today && entry.employeeId === employeeId && entry.locationId === selectedLocationId && entry.shift === selectedShift
    );
    const method = primary ? "PATCH" : "POST";
    const adjustedEntry: DailyEntry = primary
      ? {
          ...primary,
          lines: replaceCounterLines(primary, editQuantities, counterPalletTypes),
          updatedAt: new Date().toISOString(),
          updatedBy: "Counter"
        }
      : {
          ...blankEntry,
          lines: replaceCounterLines({ ...blankEntry, lines: [] }, editQuantities, counterPalletTypes),
          updatedAt: new Date().toISOString(),
          updatedBy: "Counter"
        };

    const nextEntries = upsertEntry(entriesRef.current, adjustedEntry);
    entriesRef.current = nextEntries;
    setEntries(nextEntries);
    setEditMode(false);

    try {
      await persistEntry(adjustedEntry, method);
      setStatus("Today totals updated");
    } catch {
      queueEntry(adjustedEntry, method);
      setStatus("Not yet on live board: edits saved on this device and queued for sync");
    } finally {
      setIsSaving(false);
    }
  }

  function selectRepairer(employee: Employee) {
    setSelectedEmployeeId(employee.id);
    setSelectedLocationId(employee.locationId);
    setSelectedShift(employee.shift);
    setEditMode(false);
  }

  function addPhotoFiles(files: FileList | File[] | null) {
    if (!files) return;
    const images = Array.from(files).filter((file) => file.type.startsWith("image/"));
    setPhotoFiles((current) => [...current, ...images]);
    setPhotoStatus(images.length > 0 ? `${images.length} photo${images.length === 1 ? "" : "s"} selected` : "No photos selected");
  }

  async function uploadPhotos() {
    if (!today) {
      setPhotoStatus("Date is still loading. Try again in a moment.");
      return;
    }
    if (photoFiles.length === 0) {
      setPhotoStatus("Choose or take photos first");
      return;
    }

    setIsUploadingPhotos(true);
    // Snapshot exactly what we're uploading. Photos/notes stay editable during
    // the upload, so after it we clear ONLY what we sent — anything added
    // meanwhile is kept, not wiped.
    const filesToUpload = photoFiles;
    const notesToUpload = photoNotes;
    const formData = new FormData();
    formData.set("date", today);
    formData.set("locationId", selectedLocationId);
    formData.set("shift", selectedShift);
    formData.set("uploadedBy", uploadedBy.trim() || "Counter");
    formData.set("notes", notesToUpload);
    for (const file of filesToUpload) {
      formData.append("photos", file);
    }

    try {
      const response = await fetch("/api/count-sheets", { method: "POST", body: formData });
      if (!response.ok) throw new Error("Unable to upload photos");
      setPhotoStatus(`${filesToUpload.length} photo${filesToUpload.length === 1 ? "" : "s"} uploaded to Count Sheets`);
      setPhotoFiles((current) => current.filter((file) => !filesToUpload.includes(file)));
      setPhotoNotes((current) => (current === notesToUpload ? "" : current));
    } catch {
      setPhotoStatus("Photo upload failed. Try again when connected.");
    } finally {
      setIsUploadingPhotos(false);
    }
  }

  return (
    <AuthGate>
    <main className="min-h-screen bg-[#eef2f4] text-[#16212b]">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-normal text-slate-500">MGP Counter App</p>
            <h1 className="text-2xl font-black">Production Counts</h1>
          </div>
          <button className="flex min-h-12 items-center gap-2 rounded bg-[#1f7a4d] px-4 font-black text-white" type="button" onClick={() => loadEntries().catch(() => undefined)}>
            <RefreshCw size={20} />
            Sync
          </button>
        </div>
      </header>

      <section className="mx-auto grid max-w-6xl gap-4 p-4 pb-24 lg:grid-cols-[360px_1fr]">
        <div className="grid gap-3 lg:content-start">
          <div className="grid grid-cols-3 gap-2">
            <SummaryCard label="Today's Production" value={todayTotal.toLocaleString()} />
            <SummaryCard label="Active Repairers" value={activeRepairerCount.toLocaleString()} />
            <SummaryCard label="Top Repairer" value={topRepairer ? `${topRepairer.employee.name} ${topRepairer.quantity}` : "None"} />
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
            <label className="mb-2 flex items-center gap-2 text-sm font-black text-slate-600">
              <Search size={18} />
              Search repairer
            </label>
            <input className="h-14 w-full rounded border border-slate-300 px-4 text-lg font-bold" placeholder="Search repairer..." value={search} onChange={(event) => setSearch(event.target.value)} />
            <select className="mt-3 h-14 w-full rounded border border-slate-300 px-4 text-lg font-black" value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)}>
              <option value="all">All Locations</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>{location.name}</option>
              ))}
            </select>
          </div>

          <div className="grid max-h-[520px] gap-2 overflow-auto pr-1">
            {visibleRepairers.map((employee) => {
              const total = repairerTotals.find((row) => row.employee.id === employee.id)?.quantity ?? 0;
              const isSelected = selectedEmployee?.id === employee.id;
              return (
                <button
                  key={employee.id}
                  className={`flex min-h-16 items-center justify-between rounded-lg border p-3 text-left shadow-sm ${isSelected ? "border-[#1f7a4d] bg-[#e4f5ec]" : "border-slate-200 bg-white"}`}
                  type="button"
                  onClick={() => selectRepairer(employee)}
                >
                  <span className="flex items-center gap-3">
                    <span className="flex h-11 w-11 items-center justify-center overflow-hidden rounded bg-slate-100">
                      {employee.photoDataUrl || employee.photoPath ? <img className="h-full w-full object-cover" src={employee.photoDataUrl || employee.photoPath} alt="" /> : <UserRound size={24} />}
                    </span>
                    <span>
                      <strong className="block text-lg font-black">{employee.name}</strong>
                      <span className="text-sm font-bold text-slate-500">{employee.locationId} · {employee.shift}</span>
                    </span>
                  </span>
                  <strong className="text-2xl font-black text-[#1f7a4d]">{total}</strong>
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid gap-4">
          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-black uppercase text-slate-500">Repairer</p>
                <h2 className="text-3xl font-black">{selectedEmployee?.name ?? "Select repairer"}</h2>
                <p className="mt-1 flex items-center gap-2 text-lg font-black text-slate-600">
                  <Factory size={20} />
                  {locations.find((location) => location.id === selectedLocationId)?.name ?? selectedLocationId} · {selectedShift}
                </p>
              </div>
              <div className="rounded bg-[#163024] px-5 py-3 text-right text-white">
                <p className="text-sm font-black uppercase text-white/70">Today</p>
                <strong className="block text-5xl font-black">{selectedTotal}</strong>
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-sm font-black text-slate-600">
                Location
                <select className="h-14 rounded border border-slate-300 px-4 text-lg font-black" value={selectedLocationId} onChange={(event) => setSelectedLocationId(event.target.value)}>
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>{location.name}</option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm font-black text-slate-600">
                Shift
                <select className="h-14 rounded border border-slate-300 px-4 text-lg font-black" value={selectedShift} onChange={(event) => setSelectedShift(event.target.value as Shift)}>
                  {shifts.map((shift) => (
                    <option key={shift} value={shift}>{shift}</option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <Camera size={24} className="text-[#1f7a4d]" />
              <h3 className="text-xl font-black">Count Sheet Photos</h3>
            </div>
            <p className="mt-1 text-sm font-bold text-slate-500">Photos attach to {today || "today"} · {locations.find((location) => location.id === selectedLocationId)?.name ?? selectedLocationId} · {selectedShift}</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="flex min-h-16 cursor-pointer items-center justify-center gap-2 rounded-lg bg-[#1f7a4d] px-4 text-lg font-black text-white">
                <Camera size={22} />
                Take Photo
                <input className="hidden" type="file" accept="image/*" capture="environment" onChange={(event) => addPhotoFiles(event.target.files)} />
              </label>
              <label className="flex min-h-16 cursor-pointer items-center justify-center gap-2 rounded-lg bg-[#16212b] px-4 text-lg font-black text-white">
                <ImagePlus size={22} />
                Upload Photos
                <input className="hidden" type="file" accept="image/*" multiple onChange={(event) => addPhotoFiles(event.target.files)} />
              </label>
            </div>
            <div className="mt-3">
              <DropZone onFiles={addPhotoFiles} label="Drag & drop count sheet photos here" />
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-sm font-black text-slate-600">
                Uploaded By
                <input className="h-14 rounded border border-slate-300 px-4 text-lg font-bold" value={uploadedBy} onChange={(event) => setUploadedBy(event.target.value)} />
              </label>
              <label className="grid gap-1 text-sm font-black text-slate-600">
                Notes
                <input className="h-14 rounded border border-slate-300 px-4 text-lg font-bold" placeholder="Count sheet, trailer, yard, screen..." value={photoNotes} onChange={(event) => setPhotoNotes(event.target.value)} />
              </label>
            </div>
            {photoFiles.length > 0 && (
              <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
                {photoFiles.map((file, index) => (
                  <PhotoPreview key={`${file.name}-${file.lastModified}-${index}`} file={file} onRemove={() => setPhotoFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))} />
                ))}
              </div>
            )}
            <button className="mt-3 flex min-h-14 w-full items-center justify-center gap-2 rounded bg-[#1f7a4d] text-xl font-black text-white" type="button" disabled={isUploadingPhotos || photoFiles.length === 0} onClick={uploadPhotos}>
              <Save size={22} />
              Save Photos to Count Sheets
            </button>
            <p className="mt-2 text-sm font-black text-slate-600">{photoStatus}</p>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h3 className="text-xl font-black">Pallet Type</h3>
                <p className="mt-1 text-sm font-black text-slate-500">{counterPalletTypes.length} pallet types available from {palletSource}</p>
              </div>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {counterPalletTypes.map((pallet) => (
                <button
                  key={pallet.id}
                  className={`min-h-16 rounded-lg border px-3 text-left text-lg font-black ${selectedPalletId === pallet.id ? "border-[#1f7a4d] bg-[#1f7a4d] text-white" : "border-slate-200 bg-slate-50 text-slate-900"}`}
                  type="button"
                  onClick={() => setSelectedPalletId(pallet.id)}
                >
                  {palletLabel(pallet)}
                </button>
              ))}
            </div>
            {counterPalletTypes.length === 0 && <p className="mt-3 rounded bg-steel-100 p-3 font-bold text-steel-700">No active pallet types are available. Add or activate pallet types in Admin.</p>}
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="text-xl font-black">Quick Add</h3>
            <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-5">
              {quickAmounts.map((amount) => (
                <button key={amount} className="min-h-20 rounded-lg bg-[#1f7a4d] text-3xl font-black text-white shadow-sm active:scale-[0.98]" type="button" disabled={isSaving || !selectedEmployee || !selectedPalletId || !today} onClick={() => saveQuantity(amount)}>
                  +{amount}
                </button>
              ))}
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
              <input className="h-16 rounded border border-slate-300 px-4 text-2xl font-black" inputMode="numeric" min="1" placeholder="Custom Quantity" type="number" value={customQuantity} onChange={(event) => setCustomQuantity(event.target.value)} />
              <button className="flex min-h-16 items-center justify-center gap-2 rounded bg-[#16212b] px-6 text-xl font-black text-white" type="button" disabled={isSaving || !selectedPalletId || !today || !Number(customQuantity)} onClick={() => saveQuantity(Math.max(0, Math.floor(Number(customQuantity))))}>
                <Save size={22} />
                Save
              </button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm font-black text-slate-600">
              {pendingCount > 0 ? <CloudOff size={18} className="text-steel-500" /> : <CheckCircle2 size={18} className="text-[#1f7a4d]" />}
              <span>{status}</span>
              {pendingCount > 0 && <span className="rounded bg-steel-200 px-2 py-1 text-steel-700">{pendingCount} pending sync</span>}
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-xl font-black">Today's Totals</h3>
              <button className="min-h-11 rounded bg-slate-900 px-4 font-black text-white" type="button" onClick={() => setEditMode((value) => !value)}>
                {editMode ? "Cancel" : "Edit Today"}
              </button>
            </div>
            <div className="mt-3 grid gap-2">
              {counterPalletTypes.map((pallet) => (
                <div key={pallet.id} className="grid min-h-14 grid-cols-[1fr_auto] items-center gap-3 rounded border border-slate-200 bg-slate-50 px-3">
                  <span className="font-black">{palletLabel(pallet)}</span>
                  {editMode ? (
                    <input
                      className="h-11 w-28 rounded border border-slate-300 px-3 text-right text-xl font-black"
                      inputMode="numeric"
                      min="0"
                      type="number"
                      value={editQuantities[pallet.id] ?? 0}
                      onChange={(event) => setEditQuantities((current) => ({ ...current, [pallet.id]: Math.max(0, Math.floor(Number(event.target.value) || 0)) }))}
                    />
                  ) : (
                    <strong className="text-2xl font-black text-[#1f7a4d]">{selectedBreakdown[pallet.id] ?? 0}</strong>
                  )}
                </div>
              ))}
            </div>
            {editMode && (
              <button className="mt-3 flex min-h-14 w-full items-center justify-center gap-2 rounded bg-[#1f7a4d] text-xl font-black text-white" type="button" disabled={isSaving} onClick={saveAdjustedTotals}>
                <Save size={22} />
                Save Today's Changes
              </button>
            )}
          </section>
        </div>
      </section>
    </main>
    </AuthGate>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <p className="text-xs font-black uppercase text-slate-500">{label}</p>
      <strong className="mt-1 block truncate text-2xl font-black text-[#1f7a4d]">{value}</strong>
    </div>
  );
}

function PhotoPreview({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [url, setUrl] = useState("");

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  return (
    <div className="overflow-hidden rounded border border-slate-200 bg-slate-50">
      {url && <img className="h-24 w-full object-cover" src={url} alt="" />}
      <button className="min-h-10 w-full bg-white text-sm font-black text-red-700" type="button" onClick={onRemove}>
        Remove
      </button>
    </div>
  );
}
