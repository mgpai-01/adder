import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const { id } = await params;
  const body = (await request.json()) as {
    fullName?: string;
    role?: string;
    active?: boolean;
    password?: string;
    locationId?: string | null;
    canSwitchYards?: boolean;
  };

  if (body.password) {
    if (body.password.length < 6) {
      return NextResponse.json({ ok: false, error: "Password must be at least 6 characters." });
    }
    const { error } = await auth.supabase.auth.admin.updateUserById(id, { password: body.password });
    if (error) return NextResponse.json({ ok: false, error: error.message });
  }

  const profilePatch: Record<string, unknown> = {};
  if (body.fullName !== undefined) {
    const cleanName = body.fullName.trim();
    profilePatch.full_name = cleanName;
    // Keep the @handle in sync as the name with spaces removed (e.g. KurrenBajwa).
    profilePatch.username = cleanName.replace(/\s+/g, "");
  }
  if (body.role !== undefined) {
    profilePatch.role = body.role;
    // Only managers keep a yard assignment / switch permission; clear for others.
    if (body.role !== "supervisor") {
      profilePatch.manager_yard = null;
      profilePatch.can_switch_yards = false;
    }
  }
  if (body.active !== undefined) profilePatch.active = body.active;
  if (body.locationId !== undefined && profilePatch.manager_yard === undefined) {
    profilePatch.manager_yard = (body.locationId ?? "") || null;
  }
  if (body.canSwitchYards !== undefined && profilePatch.can_switch_yards === undefined) {
    profilePatch.can_switch_yards = Boolean(body.canSwitchYards);
  }

  if (Object.keys(profilePatch).length > 0) {
    let { error } = await auth.supabase.from("profiles").update(profilePatch).eq("id", id);
    // Retry without the optional manager columns if they do not exist yet.
    if (error && /manager_yard|can_switch_yards/i.test(error.message)) {
      const { manager_yard, can_switch_yards, ...rest } = profilePatch;
      void manager_yard;
      void can_switch_yards;
      if (Object.keys(rest).length > 0) {
        ({ error } = await auth.supabase.from("profiles").update(rest).eq("id", id));
      } else {
        error = null;
      }
    }
    if (error) return NextResponse.json({ ok: false, error: error.message });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const { id } = await params;
  const { error } = await auth.supabase.auth.admin.deleteUser(id);
  if (error) return NextResponse.json({ ok: false, error: error.message });
  return NextResponse.json({ ok: true });
}
