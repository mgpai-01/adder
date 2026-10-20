import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/apiAuth";
import { canSeeSamsaraPreview } from "@/lib/previewAccess";

export const dynamic = "force-dynamic";

// The TomTom key for the fleet map's live traffic layer. Map tiles are loaded
// straight by the browser, so the key has to reach it — but only for the
// logins allowed to see the fleet map. (Restrict the key to this site's
// domains in the TomTom dashboard as a second lock.)
export async function GET(request: Request) {
  const check = await requireCaller(request);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const { data } = await check.supabase.auth.admin.getUserById(check.userId);
  if (!canSeeSamsaraPreview(data.user?.email)) {
    return NextResponse.json({ error: "Not available for this account yet" }, { status: 403 });
  }
  const key = process.env.TOMTOM_API_KEY ?? "";
  if (!key) return NextResponse.json({ error: "TOMTOM_API_KEY is not set in Vercel" }, { status: 503 });
  return NextResponse.json({ ok: true, key });
}
