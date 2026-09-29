import { NextResponse } from "next/server";
import {
  amgSessionDirectory,
  fetchAmgTimecardSheets,
  isAmgConfigured,
  openAmgSession,
  type TimecardSheet
} from "@/lib/amgTime";
import { upsertCloudEmployee } from "@/lib/cloudEmployees";
import { checkTimecardAccess, checkTimecardAccessMany, normalizePersonName } from "@/lib/timecardAccess";
import type { Employee } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const WEEK_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BATCH = 200;

// Monday through Sunday, matching how AMG runs its weekly report.
function weekEnd(weekStart: string): string {
  const start = new Date(`${weekStart}T12:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}`;
}

// Not linked yet: match this person to AMG by name (roster "Maria Reyes" vs
// AMG "MARIA REYES PINEDA"). Needs at least two shared words and no tie.
function matchCodeByName(name: string, directory: Array<{ code: string; name: string }>): string | null {
  const target = new Set(normalizePersonName(name).split(" ").filter(Boolean));
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
  return best && !tied ? best.code : null;
}

type RowResult = { ok: true; sheet: TimecardSheet } | { ok: false; error: string };

// Pulls a set of people's live sheets on ONE AMG session: one login, one
// directory download, then one batched call per AMG endpoint for everyone.
// Newly name-matched people get their code remembered on the roster.
async function pullSheets(employees: Employee[], weekStart: string): Promise<Map<string, RowResult>> {
  const session = await openAmgSession();
  const directory = amgSessionDirectory(session);
  const codeFor = new Map<string, string>();
  const results = new Map<string, RowResult>();
  const newlyLinked: Employee[] = [];

  for (const employee of employees) {
    let code = (employee.timeclockCode ?? "").trim();
    if (!code) {
      const matched = matchCodeByName(employee.name, directory);
      if (!matched) {
        results.set(employee.id, { ok: false, error: "not-matched" });
        continue;
      }
      code = matched;
      newlyLinked.push({ ...employee, timeclockCode: code });
    }
    codeFor.set(employee.id, code);
  }

  const [sheets] = await Promise.all([
    fetchAmgTimecardSheets(session, weekStart, weekEnd(weekStart), Array.from(new Set(codeFor.values()))),
    // Remembered one at a time — each is a read-modify-write of the roster.
    (async () => {
      for (const employee of newlyLinked) await upsertCloudEmployee(employee);
    })()
  ]);

  for (const [employeeId, code] of codeFor) {
    const sheet = sheets.get(code);
    results.set(employeeId, sheet ? { ok: true, sheet } : { ok: false, error: "not-matched" });
  }
  return results;
}

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

  try {
    const result = (await pullSheets([access.employee], weekStart)).get(employeeId);
    if (!result || !result.ok) return NextResponse.json({ error: "not-matched" }, { status: 404 });
    return NextResponse.json({ ok: true, sheet: result.sheet, weekStart, endDate: weekEnd(weekStart) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "AMG lookup failed." },
      { status: 502 }
    );
  }
}

// The whole crew at once: { weekStart, employeeIds } → a result per id, so the
// bonus rows all fill in together instead of trickling in a few at a time.
export async function POST(request: Request) {
  let body: { weekStart?: unknown; employeeIds?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON" }, { status: 400 });
  }
  const weekStart = typeof body.weekStart === "string" ? body.weekStart : "";
  const employeeIds = Array.isArray(body.employeeIds)
    ? Array.from(new Set(body.employeeIds.filter((id): id is string => typeof id === "string" && id.length > 0)))
    : [];
  if (!WEEK_RE.test(weekStart) || employeeIds.length === 0 || employeeIds.length > MAX_BATCH) {
    return NextResponse.json({ error: `Expected weekStart and 1–${MAX_BATCH} employeeIds` }, { status: 400 });
  }

  const access = await checkTimecardAccessMany(request, employeeIds);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  if (!isAmgConfigured()) {
    return NextResponse.json({ error: "AMG credentials are not configured" }, { status: 503 });
  }

  const results: Record<string, RowResult> = {};
  for (const denied of access.denied) results[denied.id] = { ok: false, error: denied.error };

  try {
    if (access.allowed.length > 0) {
      for (const [id, result] of await pullSheets(access.allowed, weekStart)) results[id] = result;
    }
    return NextResponse.json({ ok: true, weekStart, endDate: weekEnd(weekStart), results });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "AMG lookup failed." },
      { status: 502 }
    );
  }
}
