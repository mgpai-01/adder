import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/apiAuth";
import { canSeeSamsaraPreview } from "@/lib/previewAccess";
import { issueTrafficToken } from "@/lib/trafficToken";

export const dynamic = "force-dynamic";

// A short-lived pass for the fleet map's live traffic layer, for the logins
// allowed to see the fleet map. The browser loads traffic images from our own
// tile route with this pass; the TomTom key itself stays on the server.
export async function GET(request: Request) {
  const check = await requireCaller(request);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const { data } = await check.supabase.auth.admin.getUserById(check.userId);
  if (!canSeeSamsaraPreview(data.user?.email, check.role)) {
    return NextResponse.json({ error: "Not available for this account yet" }, { status: 403 });
  }
  if (!process.env.TOMTOM_API_KEY) return NextResponse.json({ error: "TOMTOM_API_KEY is not set in Vercel" }, { status: 503 });
  const { token, expiresAt } = issueTrafficToken(check.userId);
  return NextResponse.json({ ok: true, token, expiresAt });
}
