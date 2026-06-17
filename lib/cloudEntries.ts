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

export async function upsertCloudEntry(entry: DailyEntry): Promise<DailyEntry> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return entry;

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

  if (error) throw error;
  return entry;
}

export async function deleteCloudEntry(id: string): Promise<void> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return;
  await supabase.from("cloud_entries").delete().eq("id", id);
}
