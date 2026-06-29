import { getSupabaseServerClient } from "./supabase";
import type { DailyEntry } from "./types";

// Cloud-backed production entries. Each entry is stored whole (as jsonb) plus a
// few flat columns (date + who submitted it) so admins can browse by user/day.
// Reads/writes go through the service-role client, so they bypass row-level
// security; the browser never touches this table directly.

type CloudEntryRow = {
  id: string;
  entry_date: string | null;
  submitted_by: string | null;
  submitted_by_id: string | null;
  data: DailyEntry;
};

export function isCloudEntriesConfigured(): boolean {
  return getSupabaseServerClient() !== null;
}

function fromRow(row: CloudEntryRow): DailyEntry {
  return {
    ...row.data,
    id: row.id,
    submittedBy: row.submitted_by ?? row.data.submittedBy,
    submittedById: row.submitted_by_id ?? row.data.submittedById
  };
}

export async function readCloudEntries(): Promise<DailyEntry[]> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("cloud_entries")
    .select("id, entry_date, submitted_by, submitted_by_id, data")
    .order("entry_date", { ascending: false });

  if (error || !data) return [];
  return (data as CloudEntryRow[]).map(fromRow);
}

// Lightweight read for displays that only need quantities (e.g. the live
// board). Selects just the fields needed from the jsonb so the heavy embedded
// photos never leave the database — this is the main lever for Supabase egress.
export async function readCloudEntriesSummary(): Promise<DailyEntry[]> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("cloud_entries")
    .select("id, entry_date, employee_id:data->>employeeId, location_id:data->>locationId, shift:data->>shift, lines:data->lines")
    .order("entry_date", { ascending: false });

  if (error || !data) return [];
  return (data as Array<{ id: string; entry_date: string | null; employee_id: string | null; location_id: string | null; shift: string | null; lines: unknown }>).map(
    (row) =>
      ({
        id: row.id,
        date: row.entry_date ?? "",
        employeeId: row.employee_id ?? "",
        locationId: row.location_id ?? "",
        shift: (row.shift ?? "AM") as DailyEntry["shift"],
        lines: Array.isArray(row.lines) ? (row.lines as DailyEntry["lines"]) : []
      }) as DailyEntry
  );
}

// A tiny fingerprint of the table — total row count plus the most recent
// updated_at — so clients can cheaply detect "something changed" and only pull
// the full (photo-heavy) entries when it actually did. Keeps cross-user sync
// near-instant without constantly re-downloading photos.
export async function readCloudEntriesFingerprint(): Promise<string> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return "";

  const { data, count, error } = await supabase
    .from("cloud_entries")
    .select("updated_at", { count: "exact" })
    .order("updated_at", { ascending: false })
    .limit(1);

  if (error) return "";
  const latest = (data?.[0] as { updated_at?: string } | undefined)?.updated_at ?? "";
  return `${count ?? 0}:${latest}`;
}

export async function upsertCloudEntry(entry: DailyEntry): Promise<{ ok: boolean; error?: string }> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return { ok: false, error: "Supabase not configured" };

  const { error } = await supabase.from("cloud_entries").upsert(
    {
      id: entry.id,
      entry_date: entry.date,
      submitted_by: entry.submittedBy ?? null,
      submitted_by_id: entry.submittedById ?? null,
      data: entry,
      updated_at: new Date().toISOString()
    },
    { onConflict: "id" }
  );

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function deleteCloudEntry(id: string): Promise<void> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return;
  await supabase.from("cloud_entries").delete().eq("id", id);
}
