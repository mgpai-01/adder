import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";

// Keep the Supabase database awake so the first login of the day does not pay
// a cold-start penalty. Triggered on a schedule by vercel.json crons (and can
// be hit manually). Does the cheapest possible query.
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ ok: false, reason: "not-configured" });
  }
  try {
    await supabase.from("profiles").select("id", { head: true, count: "exact" }).limit(1);
    return NextResponse.json({ ok: true });
  } catch (caught) {
    return NextResponse.json({ ok: false, reason: (caught as Error)?.message ?? "error" });
  }
}
