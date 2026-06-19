import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";

function toEmail(login: string): string {
  const value = login.trim();
  return value.includes("@") ? value : `${value.toLowerCase()}@mgp.local`;
}

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return NextResponse.json({ users: [], error: auth.error }, { status: auth.status });

  const { data: list, error: listError } = await auth.supabase.auth.admin.listUsers({ perPage: 1000 });
  if (listError) return NextResponse.json({ users: [], error: listError.message });
  const { data: profiles } = await auth.supabase.from("profiles").select("id, username, full_name, role, active");
  const profileMap = new Map((profiles ?? []).map((profile) => [profile.id, profile]));

  const users = (list?.users ?? []).map((user) => {
    const profile = profileMap.get(user.id);
    return {
      id: user.id,
      email: user.email ?? "",
      username: profile?.username ?? "",
      fullName: profile?.full_name ?? "",
      role: profile?.role ?? "employee",
      active: profile?.active ?? true
    };
  });

  return NextResponse.json({ users });
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const body = (await request.json()) as { fullName: string; login: string; password: string; role: string };
  const login = (body.login ?? "").trim();
  const password = body.password ?? "";
  if (!login || password.length < 6) {
    return NextResponse.json({ ok: false, error: "A login and a password of at least 6 characters are required." });
  }

  const email = toEmail(login);
  const username = login.includes("@") ? login.split("@")[0] : login.toLowerCase();

  const { data: created, error: createError } = await auth.supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  });
  if (createError || !created.user) {
    return NextResponse.json({ ok: false, error: createError?.message ?? "Could not create the login." });
  }

  const { error: profileError } = await auth.supabase.from("profiles").upsert({
    id: created.user.id,
    username,
    full_name: body.fullName?.trim() || username,
    role: body.role || "employee",
    active: true
  });
  if (profileError) {
    return NextResponse.json({ ok: false, error: profileError.message });
  }

  return NextResponse.json({ ok: true });
}
