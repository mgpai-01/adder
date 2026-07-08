import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { getSupabaseClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Returns a user's viewable password — but only after the requesting admin
// re-enters their OWN password, which we verify by attempting a real sign-in.
// Returns { password: null } when the target has no viewable copy (its password
// was set before this feature, so only a hash exists).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { adminPassword?: string };
  const adminPassword = (body.adminPassword ?? "").trim();
  if (!adminPassword) {
    return NextResponse.json({ ok: false, error: "Enter your admin password." }, { status: 400 });
  }

  // Find the requesting admin's email so we can verify their password.
  const { data: adminUser, error: adminError } = await auth.supabase.auth.admin.getUserById(auth.userId);
  const adminEmail = adminUser?.user?.email;
  if (adminError || !adminEmail) {
    return NextResponse.json({ ok: false, error: "Could not verify your account." }, { status: 500 });
  }

  // Verify the admin's password by signing in with the public (anon) client.
  const anon = getSupabaseClient();
  if (!anon) return NextResponse.json({ ok: false, error: "Server not configured." }, { status: 503 });
  const { error: signInError } = await anon.auth.signInWithPassword({ email: adminEmail, password: adminPassword });
  if (signInError) {
    return NextResponse.json({ ok: false, error: "Wrong admin password." }, { status: 401 });
  }
  await anon.auth.signOut().catch(() => undefined);

  // Read the target user's viewable password.
  const { data: profile, error } = await auth.supabase
    .from("profiles")
    .select("visible_password")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    if (/visible_password/i.test(error.message)) {
      return NextResponse.json({ ok: true, password: null, reason: "column-missing" });
    }
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, password: (profile as { visible_password?: string | null })?.visible_password ?? null });
}
