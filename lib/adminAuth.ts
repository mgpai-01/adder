import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "./supabase";
import { verifyUserToken } from "./verifyToken";

type AdminCheck =
  | { ok: true; supabase: SupabaseClient; userId: string }
  | { ok: false; status: number; error: string };

// Ensures the caller is a signed-in admin before any privileged user-management
// action runs. The browser sends its session token; we cryptographically verify
// it (signature + expiry) and confirm the admin role. Privileged actions require
// a fully verified token — no unverified fallback.
export async function requireAdmin(request: Request): Promise<AdminCheck> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return { ok: false, status: 503, error: "Supabase not configured" };

  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return { ok: false, status: 401, error: "Not signed in" };

  const check = await verifyUserToken(token);
  if (!check) return { ok: false, status: 401, error: "Invalid session" };
  if (!check.verified) {
    return { ok: false, status: 401, error: "Token could not be verified — set SUPABASE_JWT_SECRET" };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", check.userId)
    .maybeSingle();

  if (!profile || profile.role !== "admin") return { ok: false, status: 403, error: "Admins only" };

  return { ok: true, supabase, userId: check.userId };
}
