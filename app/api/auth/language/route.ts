import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { verifyUserToken } from "@/lib/verifyToken";

export const dynamic = "force-dynamic";

// Saves the signed-in user's UI language preference ('en' | 'es') to their own
// profile row, using the service-role client so it works regardless of RLS. If
// the preferred_language column hasn't been added yet, this no-ops gracefully
// so the toggle still works (the choice just stays device-local until then).
export async function POST(request: Request) {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ ok: false, reason: "server-not-configured" });
  }

  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return NextResponse.json({ ok: false, reason: "no-token" }, { status: 401 });
  }

  const check = await verifyUserToken(token);
  if (!check) {
    return NextResponse.json({ ok: false, reason: "token-rejected" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { language?: string };
  const language = body.language === "es" ? "es" : body.language === "en" ? "en" : null;
  if (!language) {
    return NextResponse.json({ ok: false, reason: "invalid-language" }, { status: 400 });
  }

  const { error } = await supabase
    .from("profiles")
    .update({ preferred_language: language })
    .eq("id", check.userId);

  if (error) {
    // Column missing on older databases — treat as a soft success so the UI
    // toggle keeps working; the preference falls back to device-local storage.
    if (/preferred_language/i.test(error.message)) {
      return NextResponse.json({ ok: true, persisted: false });
    }
    return NextResponse.json({ ok: false, reason: `db: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true, persisted: true });
}
