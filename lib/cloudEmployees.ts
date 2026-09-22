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
    // deactivatedByAdmin rides along for the same reason — a poll-built record
    // missing it let the roster reconcile flip the person back to Active.
    .select(
      "id, name:data->>name, location_id:data->>locationId, role:data->>role, active:data->>active, shift:data->>shift, deleted_by_admin:data->>deletedByAdmin, deactivated_by_admin:data->>deactivatedByAdmin, admin_edited:data->adminEdited"
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
      deactivated_by_admin: string | null;
      admin_edited: string[] | null;
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
        deletedByAdmin: row.deleted_by_admin === "true",
        deactivatedByAdmin: row.deactivated_by_admin === "true",
        // Travels with the summary for the same reason deletedByAdmin does:
        // this feeds the roster poll, and a manual edit the poll doesn't know
        // about is a manual edit the reconcile will happily overwrite.
        ...(Array.isArray(row.admin_edited) ? { adminEdited: row.admin_edited } : {})
      }) as Employee
  );
}

// A name key that survives spelling drift (case, accents, extra spaces), for
// matching duplicate records of the same person across ids.
export function cloudNameKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function upsertCloudEmployee(employee: Employee): Promise<{ ok: boolean; error?: string }> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return { ok: false, error: "Supabase not configured" };

  // Merge over what the cloud already has instead of replacing it. Devices
  // sometimes save a thin copy of a person (built from the photo-free summary
  // poll, or simply stale) — a blind replace let those copies strip photos,
  // AMG codes, and crucially the deleted/inactive flags, which is how deleted
  // repairers kept coming back.
  const { data: existingRow } = await supabase.from("cloud_employees").select("data").eq("id", employee.id).maybeSingle();
  const existing = (existingRow?.data ?? null) as Employee | null;
  const next: Employee = { ...(existing ?? {}), ...employee };

  if (existing) {
    // Sticky flags: an admin's delete or manual-inactive can only be lifted by
    // a payload that EXPLICITLY carries the flag as false (the UI's undo
    // paths do). A record that simply doesn't mention the flag — a stale or
    // summary-built copy — never revives anyone.
    if (existing.deletedByAdmin && employee.deletedByAdmin !== false) {
      next.deletedByAdmin = true;
      next.active = false;
    }
    if (existing.deactivatedByAdmin && employee.deactivatedByAdmin !== false) {
      next.deactivatedByAdmin = true;
      next.active = false;
    }
  }

  const { error } = await supabase
    .from("cloud_employees")
    .upsert({ id: next.id, data: next, updated_at: new Date().toISOString() }, { onConflict: "id" });
  if (error) return { ok: false, error: error.message };

  // A delete or manual-inactive applies to the PERSON, not one record: the
  // cloud can hold duplicate records for the same name under old ids, and
  // stamping only the visible one let the hidden twin surface again — the
  // person "kept coming back" no matter how many times they were removed.
  if (next.deletedByAdmin || next.deactivatedByAdmin) {
    const key = cloudNameKey(next.name);
    if (key) {
      const all = await readCloudEmployees();
      for (const twin of all) {
        if (twin.id === next.id || cloudNameKey(twin.name) !== key) continue;
        const alreadyStamped = next.deletedByAdmin
          ? twin.deletedByAdmin === true && twin.active === false
          : twin.deactivatedByAdmin === true && twin.active === false;
        if (alreadyStamped) continue;
        await supabase.from("cloud_employees").upsert(
          {
            id: twin.id,
            data: {
              ...twin,
              active: false,
              ...(next.deletedByAdmin ? { deletedByAdmin: true } : {}),
              ...(next.deactivatedByAdmin ? { deactivatedByAdmin: true } : {})
            },
            updated_at: new Date().toISOString()
          },
          { onConflict: "id" }
        );
      }
    }
  }

  return { ok: true };
}

// Removing a repairer writes a tombstone (deletedByAdmin) rather than dropping
// the row: a hard delete erased the very marker other devices needed to learn
// the person was removed, so their stale copies pushed the record straight
// back. The tombstone spreads to same-name duplicates via upsertCloudEmployee.
export async function deleteCloudEmployee(id: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return { ok: false, error: "Supabase not configured" };

  const { data: row } = await supabase.from("cloud_employees").select("data").eq("id", id).maybeSingle();
  const existing = (row?.data ?? null) as Employee | null;
  if (!existing) return { ok: true };
  return upsertCloudEmployee({ ...existing, id, active: false, deletedByAdmin: true });
}
