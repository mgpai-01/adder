import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "./supabase";
import { verifyUserToken } from "./verifyToken";

// Declared here rather than imported from lib/auth.tsx, which is a client
// module — these guards run on the server.
type AppRole = "admin" | "supervisor" | "employee";

// These routes run with the service-role key, which bypasses row level
// security — so the database policies do not protect them and the check has to
// happen here. Without it, anyone who knows the URL can read every entry and
// rewrite pay rates.

type CallerCheck =
  | { ok: true; supabase: SupabaseClient; userId: string; role: AppRole }
  | { ok: false; status: number; error: string };

// Verifies the caller's Supabase session and looks up their role. `roles`
// limits who may proceed; omit it to allow any signed-in user.
export async function requireCaller(request: Request, roles?: AppRole[]): Promise<CallerCheck> {
  const supabase = getSupabaseServerClient();
  // With no Supabase configured there is no session to verify and nothing
  // durable to protect (local-file storage on a single machine), so let the
  // request through rather than bricking a local/offline install.
  if (!supabase) return { ok: false, status: 503, error: "Supabase not configured" };

  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return { ok: false, status: 401, error: "Not signed in" };

  const check = await verifyUserToken(token);
  if (!check?.verified) return { ok: false, status: 401, error: "Invalid session" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, active")
    .eq("id", check.userId)
    .maybeSingle();

  if (!profile) return { ok: false, status: 403, error: "No profile for this account" };
  if (profile.active === false) return { ok: false, status: 403, error: "Account is inactive" };

  const role = profile.role as AppRole;
  if (roles && !roles.includes(role)) {
    return { ok: false, status: 403, error: `Requires ${roles.join(" or ")}` };
  }

  return { ok: true, supabase, userId: check.userId, role };
}

// True when Supabase is configured, i.e. when there are real accounts to check
// against. Local-only installs have no auth to enforce.
export function authEnforced(): boolean {
  return Boolean(getSupabaseServerClient());
}

// Guard for a route handler: returns a 401/403 response when the caller isn't
// allowed, or null when they may proceed.
export async function denyUnless(request: Request, roles?: AppRole[]): Promise<Response | null> {
  if (!authEnforced()) return null;
  const check = await requireCaller(request, roles);
  if (check.ok) return null;
  return Response.json({ error: check.error }, { status: check.status });
}
