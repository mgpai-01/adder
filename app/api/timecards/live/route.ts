import { NextResponse } from "next/server";
import { fetchAmgEmployeeDirectory, fetchAmgTimecardSheet, isAmgConfigured } from "@/lib/amgTime";
import { upsertCloudEmployee } from "@/lib/cloudEmployees";
import { checkTimecardAccess, normalizePersonName } from "@/lib/timecardAccess";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const WEEK_RE = /^\d{4}-\d{2}-\d{2}$/;

// Live time sheet straight from AMG for one person and one week — the data
// the printed Timecard report is made of, updating as the week goes on. The
// browser lays it out identical to the paper; when the official weekly PDF
// has been uploaded, the client prefers that file over this feed.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const weekStart = url.searchParams.get("weekStart") ?? "";
  const employeeId = url.searchParams.get("employeeId") ?? "";
  if (!WEEK_RE.test(weekStart) || !employeeId) {
    return NextResponse.json({ error: "Expected weekStart and employeeId" }, { status: 400 });
  }

  const access = await checkTimecardAccess(request, employeeId);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  if (!isAmgConfigured()) {
    return NextResponse.json({ error: "AMG credentials are not configured" }, { status: 503 });
  }

  // Monday through Sunday, matching how AMG runs its weekly report.
  const start = new Date(`${weekStart}T12:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const pad = (value: number) => String(value).padStart(2, "0");
  const endDate = `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}`;

  try {
    let code = (access.employee.timeclockCode ?? "").trim();
    if (!code) {
      // Not linked yet: match this person to AMG by name (roster "Maria
      // Reyes" vs AMG "MARIA REYES PINEDA") and remember the code on their
      // roster record, so every later lookup is instant.
      const directory = await fetchAmgEmployeeDirectory();
      const target = new Set(normalizePersonName(access.employee.name).split(" ").filter(Boolean));
      let best: { code: string; score: number } | null = null;
      let tied = false;
      for (const block of directory) {
        const words = normalizePersonName(block.name).split(" ").filter(Boolean);
        const score = words.filter((word) => target.has(word)).length;
        if (score < 2) continue;
        if (!best || score > best.score) {
          best = { code: block.code, score };
          tied = false;
        } else if (score === best.score && block.code !== best.code) {
          tied = true;
        }
      }
      if (!best || tied) return NextResponse.json({ error: "not-matched" }, { status: 404 });
      code = best.code;
      await upsertCloudEmployee({ ...access.employee, timeclockCode: code });
    }

    const sheet = await fetchAmgTimecardSheet(weekStart, endDate, code);
    if (!sheet) return NextResponse.json({ error: "not-matched" }, { status: 404 });
    return NextResponse.json({ ok: true, sheet, weekStart, endDate });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "AMG lookup failed." },
      { status: 502 }
    );
  }
}
