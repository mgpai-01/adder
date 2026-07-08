import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import type { SupabaseClient } from "@supabase/supabase-js";

function toEmail(login: string): string {
  const value = login.trim();
  return value.includes("@") ? value : `${value.toLowerCase()}@mgp.local`;
}

// Managers (supervisors) can be limited to specific yards, stored as a comma
// list in manager_yard. Empty = all yards. Everyone else sees all yards.
function yardsForRole(role: string, allowedYards?: string[] | null): string | null {
  if (role !== "supervisor") return null;
  const cleaned = (allowedYards ?? []).map((value) => (value ?? "").trim()).filter(Boolean);
  return cleaned.length ? cleaned.join(",") : null;
}

// Upsert a profile row, retrying without optional columns (manager_yard,
// visible_password) if they do not exist yet on an older database.
async function upsertProfile(supabase: SupabaseClient, row: Record<string, unknown>): Promise<string | null> {
  let attempt = { ...row };
  for (let i = 0; i < 3; i += 1) {
    const { error } = await supabase.from("profiles").upsert(attempt);
    if (!error) return null;
    if (/visible_password/i.test(error.message) && "visible_password" in attempt) {
      const { visible_password, ...rest } = attempt;
      void visible_password;
      attempt = rest;
      continue;
    }
    if (/manager_yard/i.test(error.message) && "manager_yard" in attempt) {
      const { manager_yard, ...rest } = attempt;
      void manager_yard;
      attempt = rest;
      continue;
    }
    return error.message;
  }
  return null;
}

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return NextResponse.json({ users: [], error: auth.error }, { status: auth.status });

  const { data: list, error: listError } = await auth.supabase.auth.admin.listUsers({ perPage: 1000 });
  if (listError) return NextResponse.json({ users: [], error: listError.message });

  // manager_yard may not exist on older databases; fall back without it.
  let { data: profiles, error: profilesError } = await auth.supabase
    .from("profiles")
    .select("id, username, full_name, role, active, manager_yard");
  if (profilesError && /manager_yard/i.test(profilesError.message)) {
    ({ data: profiles } = await auth.supabase.from("profiles").select("id, username, full_name, role, active"));
  }
  const profileMap = new Map((profiles ?? []).map((profile) => [profile.id, profile]));

  const users = (list?.users ?? []).map((user) => {
    const profile = profileMap.get(user.id) as
      | { username?: string; full_name?: string; role?: string; active?: boolean; manager_yard?: string | null }
      | undefined;
    return {
      id: user.id,
      email: user.email ?? "",
      username: profile?.username ?? "",
      fullName: profile?.full_name ?? "",
      role: profile?.role ?? "employee",
      active: profile?.active ?? true,
      allowedYards: (profile?.manager_yard ?? "").split(",").map((value) => value.trim()).filter(Boolean)
    };
  });

  return NextResponse.json({ users });
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const body = (await request.json()) as { fullName: string; login: string; password: string; role: string; allowedYards?: string[] };
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
    manager_yard: yardsForRole(role, body.allowedYards),
    // Viewable copy so an admin can re-view it later (admin-gated read).
    visible_password: password
  });
  if (profileError) {
    return NextResponse.json({ ok: false, error: profileError });
  }

  return NextResponse.json({ ok: true });
}
