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
  };

  if (body.password) {
    if (body.password.length < 6) {
      return NextResponse.json({ ok: false, error: "Password must be at least 6 characters." });
    }
    const { error } = await auth.supabase.auth.admin.updateUserById(id, { password: body.password });
    if (error) return NextResponse.json({ ok: false, error: error.message });
  }

  const profilePatch: Record<string, unknown> = {};
  if (body.fullName !== undefined) profilePatch.full_name = body.fullName.trim();
  if (body.role !== undefined) profilePatch.role = body.role;
  if (body.active !== undefined) profilePatch.active = body.active;

  if (Object.keys(profilePatch).length > 0) {
    const { error } = await auth.supabase.from("profiles").update(profilePatch).eq("id", id);
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
