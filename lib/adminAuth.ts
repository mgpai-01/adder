import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "./supabase";

type AdminCheck =
  | { ok: true; supabase: SupabaseClient }
  | { ok: false; status: number; error: string };

// Ensures the caller is a signed-in admin before any privileged user-management
// action runs. The browser sends its session token; we verify it and the role.
export async function requireAdmin(request: Request): Promise<AdminCheck> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return { ok: false, status: 503, error: "Supabase not configured" };

  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return { ok: false, status: 401, error: "Not signed in" };

  const { data: userData } = await supabase.auth.getUser(token);
  if (!userData.user) return { ok: false, status: 401, error: "Invalid session" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (!profile || profile.role !== "admin") return { ok: false, status: 403, error: "Admins only" };

  return { ok: true, supabase };
}
