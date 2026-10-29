import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/apiAuth";
import { canSeeSamsaraPreview } from "@/lib/previewAccess";
import { isSamsaraConfigured } from "@/lib/samsara";
import { resolveYardAreas } from "@/lib/yardAreas";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// MGP's yards as areas on the map, for the fleet map's Yard board and purple
// outlines (lib/yardAreas). Same preview lock as the rest of the fleet map.
export async function GET(request: Request) {
  const check = await requireCaller(request);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const { data } = await check.supabase.auth.admin.getUserById(check.userId);
  if (!canSeeSamsaraPreview(data.user?.email)) {
    return NextResponse.json({ error: "Not available for this account yet" }, { status: 403 });
  }
  if (!isSamsaraConfigured()) {
    return NextResponse.json({ error: "SAMSARA_API_TOKEN is not set in Vercel" }, { status: 503 });
  }

  try {
    const { yards, warnings } = await resolveYardAreas();
    return NextResponse.json({ ok: true, yards, warnings });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Couldn't place the yards" }, { status: 502 });
  }
}
