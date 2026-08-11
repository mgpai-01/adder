import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { verifyUserToken } from "@/lib/verifyToken";

export const dynamic = "force-dynamic";

// Per-account UI preferences, stored on the Supabase auth user's metadata so
// no table migration is needed. Currently: the personal pallet-row order for
// the entry screen. Each account keeps its own order across devices.

const MAX_IDS = 500;
const MAX_ID_LENGTH = 120;

function sanitizePalletOrder(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids = value.filter((item): item is string => typeof item === "string" && item.length > 0 && item.length <= MAX_ID_LENGTH);
  return ids.slice(0, MAX_IDS);
}

async function callerId(request: Request): Promise<string | null> {
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const check = await verifyUserToken(token);
  return check?.verified ? check.userId : null;
}

export async function GET(request: Request) {
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ ok: false, reason: "server-not-configured" });

  const userId = await callerId(request);
  if (!userId) return NextResponse.json({ ok: false, reason: "not-signed-in" }, { status: 401 });

  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error || !data?.user) return NextResponse.json({ ok: false, reason: "user-not-found" }, { status: 404 });

  const palletOrder = sanitizePalletOrder((data.user.user_metadata as Record<string, unknown> | null)?.pallet_order);
  return NextResponse.json({ ok: true, palletOrder });
}

export async function POST(request: Request) {
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ ok: false, reason: "server-not-configured" });

  const userId = await callerId(request);
  if (!userId) return NextResponse.json({ ok: false, reason: "not-signed-in" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { palletOrder?: unknown };
  const palletOrder = sanitizePalletOrder(body.palletOrder);
  if (!palletOrder) return NextResponse.json({ ok: false, reason: "invalid-pallet-order" }, { status: 400 });

  // Merge over the existing metadata — updateUserById replaces the whole
  // user_metadata object, and other keys (if any) must survive.
  const { data: existing } = await supabase.auth.admin.getUserById(userId);
  const metadata = { ...((existing?.user?.user_metadata as Record<string, unknown>) ?? {}), pallet_order: palletOrder };

  const { error } = await supabase.auth.admin.updateUserById(userId, { user_metadata: metadata });
  if (error) return NextResponse.json({ ok: false, reason: `db: ${error.message}` }, { status: 500 });

  return NextResponse.json({ ok: true });
}
