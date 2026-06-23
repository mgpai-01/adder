import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import type { SupabaseClient } from "@supabase/supabase-js";

function toEmail(login: string): string {
  const value = login.trim();
  return value.includes("@") ? value : `${value.toLowerCase()}@mgp.local`;
}

// Only managers (supervisors) are pinned to a yard; everyone else sees all yards.
function yardForRole(role: string, locationId?: string | null): string | null {
  if (role !== "supervisor") return null;
  const value = (locationId ?? "").trim();
  return value || null;
}

// Upsert a profile row, retrying without location_id if that column does not
// exist yet (older databases before the migration is run).
async function upsertProfile(supabase: SupabaseClient, row: Record<string, unknown>): Promise<string | null> {
  let { error } = await supabase.from("profiles").upsert(row);
  if (error && /location_id/i.test(error.message)) {
    const { location_id, ...rest } = row;
    void location_id;
    ({ error } = await supabase.from("profiles").upsert(rest));
  }
  return error?.message ?? null;
}

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return NextResponse.json({ users: [], error: auth.error }, { status: auth.status });

  const { data: list, error: listError } = await auth.supabase.auth.admin.listUsers({ perPage: 1000 });
  if (listError) return NextResponse.json({ users: [], error: listError.message });

  // location_id may not exist on older databases; fall back without it.
  let { data: profiles, error: profilesError } = await auth.supabase
    .from("profiles")
    .select("id, username, full_name, role, active, location_id");
  if (profilesError && /location_id/i.test(profilesError.message)) {
    ({ data: profiles } = await auth.supabase.from("profiles").select("id, username, full_name, role, active"));
  }
  const profileMap = new Map((profiles ?? []).map((profile) => [profile.id, profile]));

  const users = (list?.users ?? []).map((user) => {
    const profile = profileMap.get(user.id) as
      | { username?: string; full_name?: string; role?: string; active?: boolean; location_id?: string | null }
      | undefined;
    return {
      id: user.id,
      email: user.email ?? "",
      username: profile?.username ?? "",
      fullName: profile?.full_name ?? "",
      role: profile?.role ?? "employee",
      active: profile?.active ?? true,
      locationId: profile?.location_id ?? null
    };
  });

  return NextResponse.json({ users });
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const body = (await request.json()) as { fullName: string; login: string; password: string; role: string; locationId?: string };
  const login = (body.login ?? "").trim();
  const password = body.password ?? "";
  if (!login || password.length < 6) {
    return NextResponse.json({ ok: false, error: "A login and a password of at least 6 characters are required." });
  }

  const email = toEmail(login);
  const derivedFromName = (body.fullName ?? "").trim().replace(/\s+/g, "");
  const username = derivedFromName || (login.includes("@") ? login.split("@")[0] : login.toLowerCase());
  const role = body.role || "employee";

  const { data: created, error: createError } = await auth.supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  });
  if (createError || !created.user) {
    return NextResponse.json({ ok: false, error: createError?.message ?? "Could not create the login." });
  }

  const profileError = await upsertProfile(auth.supabase, {
    id: created.user.id,
    username,
    full_name: body.fullName?.trim() || username,
    role,
    active: true,
    location_id: yardForRole(role, body.locationId)
  });
  if (profileError) {
    return NextResponse.json({ ok: false, error: profileError });
  }

  return NextResponse.json({ ok: true });
}
