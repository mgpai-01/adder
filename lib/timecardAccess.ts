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
  const check = await requireCaller(request);
  if (!check.ok) return { ok: false, status: check.status, error: check.error };

  const employees = withoutDeleted(await readCloudEmployees());
  const employee = employees.find((item) => item.id === employeeId);
  if (!employee) return { ok: false, status: 404, error: "Unknown person" };

  if (check.role !== "admin") {
    const { data: profile } = await check.supabase
      .from("profiles")
      .select("full_name, manager_yard")
      .eq("id", check.userId)
      .maybeSingle();
    if (check.role === "supervisor") {
      const yards = String((profile as { manager_yard?: string } | null)?.manager_yard ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      if (!yards.includes(employee.locationId)) {
        return { ok: false, status: 403, error: "This person is not in your yard" };
      }
    } else {
      const ownName = normalizePersonName(String((profile as { full_name?: string } | null)?.full_name ?? ""));
      if (!ownName || ownName !== normalizePersonName(employee.name)) {
        return { ok: false, status: 403, error: "You can only open your own time card" };
      }
    }
  }

  return { ok: true, employee };
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
