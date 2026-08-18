import { NextResponse } from "next/server";
import { fetchAmgHours, isAmgConfigured } from "@/lib/amgTime";
import { denyUnless } from "@/lib/apiAuth";

export const dynamic = "force-dynamic";

// Pulls hours straight from AMG Time for a date range and returns them in the
// same block shape the file importer uses, so the Payroll screen can show the
// identical preview/apply flow. Admins and managers only — this reaches into
// the company's time-clock account.
export async function POST(request: Request) {
  const denied = await denyUnless(request, ["admin", "supervisor"]);
  if (denied) return denied;

  if (!isAmgConfigured()) {
    return NextResponse.json(
      { ok: false, error: "AMG credentials are not set. Add AMG_USERNAME and AMG_PASSWORD in Vercel → Settings → Environment Variables, then redeploy." },
      { status: 503 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as { startDate?: string; endDate?: string };
  const isoDate = /^\d{4}-\d{2}-\d{2}$/;
  const startDate = String(body.startDate ?? "");
  const endDate = String(body.endDate ?? "");
  if (!isoDate.test(startDate) || !isoDate.test(endDate) || startDate > endDate) {
    return NextResponse.json({ ok: false, error: "Send startDate and endDate as yyyy-mm-dd." }, { status: 400 });
  }

  try {
    const blocks = await fetchAmgHours(startDate, endDate);
    return NextResponse.json({ ok: true, blocks });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "AMG sync failed." },
      { status: 502 }
    );
  }
}
