import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/apiAuth";
import { canSeeSamsaraPreview } from "@/lib/previewAccess";

export const dynamic = "force-dynamic";

// Whether the signed-in user may see the Samsara fleet map — the Dashboard
// asks this before showing the button, so the rule lives in one place
// (lib/previewAccess) and the button can't disagree with the data routes.
export async function GET(request: Request) {
  const check = await requireCaller(request);
  if (!check.ok) return NextResponse.json({ allowed: false, error: check.error }, { status: check.status });
  const { data } = await check.supabase.auth.admin.getUserById(check.userId);
  return NextResponse.json({ allowed: canSeeSamsaraPreview(data.user?.email) });
}
