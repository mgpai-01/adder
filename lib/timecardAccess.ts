import { createHmac } from "node:crypto";
import { requireCaller } from "./apiAuth";
import { readCloudEmployees, withoutDeleted } from "./cloudEmployees";
import type { Employee } from "./types";

// Where a person's stored AMG paper lives for a week. The bucket is public,
// so the path itself is the secret: an HMAC keyed with the service-role key,
// which never leaves the server.
export function timecardStoragePath(weekStart: string, code: string): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const digest = createHmac("sha256", key).update(`timecard|${weekStart}|${code}`).digest("hex").slice(0, 32);
  return `timecards/${weekStart}/${digest}.pdf`;
}

// Who may open a person's time card: admins anyone; managers the people in
// their yards; everyone else only themself (their account's full name matched
// against the roster). Shared by the stored-paper and live-AMG endpoints so
// the rule can never drift between them.
export async function checkTimecardAccess(
  request: Request,
  employeeId: string
): Promise<{ ok: true; employee: Employee } | { ok: false; status: number; error: string }> {
  const result = await checkTimecardAccessMany(request, [employeeId]);
  if (!result.ok) return result;
  const employee = result.allowed[0];
  if (employee) return { ok: true, employee };
  const denied = result.denied[0];
  return { ok: false, status: denied?.status ?? 404, error: denied?.error ?? "Unknown person" };
}

// Same rule for a whole crew in one pass: signs the caller in once, reads the
// roster once, looks their profile up once, then sorts every id into allowed
// or denied (with the reason the single check would have given).
export async function checkTimecardAccessMany(
  request: Request,
  employeeIds: string[]
): Promise<
  | { ok: true; allowed: Employee[]; denied: Array<{ id: string; status: number; error: string }> }
  | { ok: false; status: number; error: string }
> {
  const check = await requireCaller(request);
  if (!check.ok) return { ok: false, status: check.status, error: check.error };

  const employees = withoutDeleted(await readCloudEmployees());
  const byId = new Map(employees.map((item) => [item.id, item]));

  let yards: string[] = [];
  let ownName = "";
  if (check.role !== "admin") {
    const { data: profile } = await check.supabase
      .from("profiles")
      .select("full_name, manager_yard")
      .eq("id", check.userId)
      .maybeSingle();
    yards = String((profile as { manager_yard?: string } | null)?.manager_yard ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    ownName = normalizePersonName(String((profile as { full_name?: string } | null)?.full_name ?? ""));
  }

  const allowed: Employee[] = [];
  const denied: Array<{ id: string; status: number; error: string }> = [];
  for (const id of employeeIds) {
    const employee = byId.get(id);
    if (!employee) {
      denied.push({ id, status: 404, error: "Unknown person" });
    } else if (check.role === "admin") {
      allowed.push(employee);
    } else if (check.role === "supervisor") {
      if (yards.includes(employee.locationId)) allowed.push(employee);
      else denied.push({ id, status: 403, error: "This person is not in your yard" });
    } else if (ownName && ownName === normalizePersonName(employee.name)) {
      allowed.push(employee);
    } else {
      denied.push({ id, status: 403, error: "You can only open your own time card" });
    }
  }
  return { ok: true, allowed, denied };
}

export function normalizePersonName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
