import { getSupabaseServerClient } from "./supabase";

export type ChangeLogEntry = {
  id?: string;
  at?: string;
  actor: string;
  action: string;
  targetType: string;
  targetName: string;
  summary: string;
};

// Append-only audit trail of admin changes, stored in the cloud so everyone
// sees the same history.

export async function readChangeLog(): Promise<ChangeLogEntry[]> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("cloud_change_log")
    .select("id, at, actor, action, target_type, target_name, summary")
    .order("at", { ascending: false })
    .limit(500);

  if (error || !data) return [];
  return data.map((row) => ({
    id: row.id,
    at: row.at,
    actor: row.actor ?? "",
    action: row.action ?? "",
    targetType: row.target_type ?? "",
    targetName: row.target_name ?? "",
    summary: row.summary ?? ""
  }));
}

export async function insertChangeLog(entry: ChangeLogEntry): Promise<{ ok: boolean; error?: string }> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return { ok: false, error: "Supabase not configured" };

  const { error } = await supabase.from("cloud_change_log").insert({
    actor: entry.actor,
    action: entry.action,
    target_type: entry.targetType,
    target_name: entry.targetName,
    summary: entry.summary
  });

  return error ? { ok: false, error: error.message } : { ok: true };
}
