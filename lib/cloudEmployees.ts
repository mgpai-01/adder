import { getSupabaseServerClient } from "./supabase";
import type { Employee } from "./types";

// Cloud-backed roster. Each repairer/manager profile is stored whole (as jsonb)
// so any admin's change is shared with everyone. Accessed via the service-role
// client; the browser goes through /api/employees.

export function isCloudRosterConfigured(): boolean {
  return getSupabaseServerClient() !== null;
}

// Deleted repairers stay in the table as tombstones so the removal sticks
// across devices, which means every reader has to drop them. The one exception
// is /api/employees itself — the browser needs the tombstones to learn that a
// deletion happened somewhere else.
export function withoutDeleted(list: Employee[]): Employee[] {
  return list.filter((employee) => !employee.deletedByAdmin);
}

export async function readCloudEmployees(): Promise<Employee[]> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return [];

  const { data, error } = await supabase.from("cloud_employees").select("id, data");
  if (error || !data) return [];
  return data.map((row) => ({ ...(row.data as Employee), id: row.id }));
}

// Roster without the base64 profile photos, for displays that only need names
// (e.g. the live board). Keeps embedded photos out of the response to save
// Supabase egress.
export async function readCloudEmployeesSummary(): Promise<Employee[]> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("cloud_employees")
    // deletedByAdmin has to travel with the summary: this feeds the roster
    // poll, and without it a deleted repairer reappears as merely inactive.
    .select(
      "id, name:data->>name, location_id:data->>locationId, role:data->>role, active:data->>active, shift:data->>shift, deleted_by_admin:data->>deletedByAdmin"
    );
  if (error || !data) return [];
  return (
    data as Array<{
      id: string;
      name: string | null;
      location_id: string | null;
      role: string | null;
      active: string | null;
      shift: string | null;
      deleted_by_admin: string | null;
    }>
  ).map(
    (row) =>
      ({
        id: row.id,
        name: row.name ?? "",
        locationId: row.location_id ?? "",
        role: (row.role ?? undefined) as Employee["role"],
        active: row.active !== "false",
        shift: (row.shift ?? "AM") as Employee["shift"],
        deletedByAdmin: row.deleted_by_admin === "true"
      }) as Employee
  );
}

export async function upsertCloudEmployee(employee: Employee): Promise<{ ok: boolean; error?: string }> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return { ok: false, error: "Supabase not configured" };

  const { error } = await supabase
    .from("cloud_employees")
    .upsert({ id: employee.id, data: employee, updated_at: new Date().toISOString() }, { onConflict: "id" });

  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function deleteCloudEmployee(id: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return { ok: false, error: "Supabase not configured" };

  const { error } = await supabase.from("cloud_employees").delete().eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}
