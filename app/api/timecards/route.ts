import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/apiAuth";
import { readCloudEmployees } from "@/lib/cloudEmployees";
import { getSupabaseServerClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The original AMG Timecard paper, stored per person per week.
//
// The admin downloads AMG's weekly Timecard report (one Crystal-Reports PDF,
// one page per employee) and uploads it on the Production Grid. The browser
// splits it into each person's untouched original page(s) and POSTs them
// here; each lands in storage under a name only the server can compute.
// GET hands back one person's page for one week, after checking the caller
// is allowed to see that person's card.

const BUCKET = "count-sheets";

// Unguessable but deterministic file name: the bucket is public, so the path
// itself is the secret. Keyed with the service-role key, which never leaves
// the server.
function timecardPath(weekStart: string, code: string): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const digest = createHmac("sha256", key).update(`timecard|${weekStart}|${code}`).digest("hex").slice(0, 32);
  return `timecards/${weekStart}/${digest}.pdf`;
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const WEEK_RE = /^\d{4}-\d{2}-\d{2}$/;
const CODE_RE = /^\d{3,8}$/;

export async function POST(request: Request) {
  const check = await requireCaller(request, ["admin", "supervisor"]);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const body = (await request.json().catch(() => null)) as {
    weekStart?: string;
    blocks?: Array<{ code?: string; pdfBase64?: string }>;
  } | null;
  const weekStart = body?.weekStart ?? "";
  const blocks = Array.isArray(body?.blocks) ? body.blocks : [];
  if (!WEEK_RE.test(weekStart) || blocks.length === 0) {
    return NextResponse.json({ error: "Expected weekStart (yyyy-mm-dd) and blocks" }, { status: 400 });
  }

  const stored: string[] = [];
  for (const block of blocks) {
    const code = (block.code ?? "").trim();
    if (!CODE_RE.test(code) || !block.pdfBase64) continue;
    const bytes = Buffer.from(block.pdfBase64, "base64");
    // A single person's report page is tens of KB; anything huge is not that.
    if (bytes.length === 0 || bytes.length > 4 * 1024 * 1024) continue;
    const { error } = await check.supabase.storage.from(BUCKET).upload(timecardPath(weekStart, code), bytes, {
      contentType: "application/pdf",
      upsert: true
    });
    if (error) return NextResponse.json({ error: error.message, stored }, { status: 500 });
    stored.push(code);
  }
  return NextResponse.json({ ok: true, stored });
}

export async function GET(request: Request) {
  const check = await requireCaller(request);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const url = new URL(request.url);
  const weekStart = url.searchParams.get("weekStart") ?? "";
  const employeeId = url.searchParams.get("employeeId") ?? "";
  if (!WEEK_RE.test(weekStart) || !employeeId) {
    return NextResponse.json({ error: "Expected weekStart and employeeId" }, { status: 400 });
  }

  const employees = await readCloudEmployees();
  const employee = employees.find((item) => item.id === employeeId);
  if (!employee) return NextResponse.json({ error: "Unknown person" }, { status: 404 });

  // Who may see this person's card: admins anyone; managers their yards;
  // everyone else only themselves (matched by their account's full name).
  if (check.role !== "admin") {
    const { data: profile } = await check.supabase
      .from("profiles")
      .select("full_name, manager_yard")
      .eq("id", check.userId)
      .maybeSingle();
    if (check.role === "supervisor") {
      const yards = String((profile as { manager_yard?: string } | null)?.manager_yard ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      if (!yards.includes(employee.locationId)) {
        return NextResponse.json({ error: "This person is not in your yard" }, { status: 403 });
      }
    } else {
      const ownName = normalizeName(String((profile as { full_name?: string } | null)?.full_name ?? ""));
      if (!ownName || ownName !== normalizeName(employee.name)) {
        return NextResponse.json({ error: "You can only open your own time card" }, { status: 403 });
      }
    }
  }

  const code = (employee.timeclockCode ?? "").trim();
  if (!code) return NextResponse.json({ error: "not-matched" }, { status: 404 });

  const path = timecardPath(weekStart, code);
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Cloud storage not configured" }, { status: 503 });
  const folder = path.slice(0, path.lastIndexOf("/"));
  const fileName = path.slice(path.lastIndexOf("/") + 1);
  const { data: listing } = await supabase.storage.from(BUCKET).list(folder, { search: fileName });
  if (!listing || !listing.some((item) => item.name === fileName)) {
    return NextResponse.json({ error: "no-file" }, { status: 404 });
  }
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return NextResponse.json({ ok: true, url: data.publicUrl });
}
