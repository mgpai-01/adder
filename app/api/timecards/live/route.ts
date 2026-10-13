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

type DirectoryEntry = { code: string; name: string; active: boolean };

// Not linked yet: match this person to AMG by name (roster "Maria Reyes" vs
// AMG "MARIA REYES PINEDA"). Needs at least two shared words. AMG often keeps
// more than one record under the same name (an old one left behind, or one
// per yard), so a tie is narrowed to the ACTIVE records first; whatever is
// still tied comes back as `candidates` for the caller to settle by hours.
// With no match at all, `reason` says why in words a manager can act on.
function matchCodeByName(
  name: string,
  directory: DirectoryEntry[]
): { code: string } | { code: null; candidates: DirectoryEntry[]; reason: string } {
  const target = new Set(normalizePersonName(name).split(" ").filter(Boolean));
  const scored = directory
    .map((block) => ({
      ...block,
      score: normalizePersonName(block.name)
        .split(" ")
        .filter((word) => target.has(word)).length
    }))
    .filter((block) => block.score > 0)
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (best && best.score >= 2) {
    let tied = scored.filter((block) => block.score === best.score);
    tied = tied.filter((block, index) => tied.findIndex((other) => other.code === block.code) === index);
    const active = tied.filter((block) => block.active);
    if (active.length > 0) tied = active;
    if (tied.length === 1) return { code: tied[0].code };
    const names = tied.slice(0, 4).map((block) => `${block.name} (${block.code})`).join(", ");
    return {
      code: null,
      candidates: tied,
      reason: `More than one AMG employee matches "${name}": ${names}. Link the right one by uploading an AMG Timecard PDF.`
    };
  }
  const near = scored.slice(0, 3).map((block) => `${block.name} (${block.code})`).join(", ");
  return {
    code: null,
    candidates: [],
    reason:
      `AMG's employee list (${directory.length} people) has no one named like "${name}".` +
      (near ? ` Closest: ${near}.` : "") +
      " If they're missing from AMG entirely, the AMG login the app uses can't see their yard."
  };
}

type RowResult = { ok: true; sheet: TimecardSheet } | { ok: false; error: string; detail?: string };

const paidHours = (sheet: TimecardSheet | undefined) => sheet?.totals.total ?? 0;

// Pulls a set of people's live sheets on ONE AMG session: one login, one
// directory download, then one batched call per AMG endpoint for everyone.
// Newly name-matched people get their code remembered on the roster.
async function pullSheets(employees: Employee[], weekStart: string): Promise<Map<string, RowResult>> {
  const session = await openAmgSession();
  const directory = amgSessionDirectory(session);
  const knownCodes = new Set(directory.map((block) => block.code));
  const codeFor = new Map<string, string>();
  // People whose name matches several AMG records equally well: settled below
  // by which record actually has hours this week.
  const ambiguous = new Map<string, { codes: string[]; reason: string }>();
  const results = new Map<string, RowResult>();
  const newlyLinked: Employee[] = [];

  for (const employee of employees) {
    let code = (employee.timeclockCode ?? "").trim();
    // A remembered code AMG no longer has is as good as none: fall back to
    // the name, and say so if that fails too.
    const staleCode = code && !knownCodes.has(code) ? code : "";
    if (!code || staleCode) {
      const matched = matchCodeByName(employee.name, directory);
      if (matched.code === null) {
        if (matched.candidates.length > 1) {
          ambiguous.set(employee.id, { codes: matched.candidates.map((block) => block.code), reason: matched.reason });
          continue;
        }
        const detail = staleCode
          ? `Linked to AMG code ${staleCode}, but AMG has no employee with that code. ${matched.reason}`
          : matched.reason;
        results.set(employee.id, { ok: false, error: "not-matched", detail });
        continue;
      }
      code = matched.code;
      newlyLinked.push({ ...employee, timeclockCode: code });
    }
    codeFor.set(employee.id, code);
  }

  const wantedCodes = new Set(codeFor.values());
  for (const { codes } of ambiguous.values()) for (const code of codes) wantedCodes.add(code);

  const [sheets] = await Promise.all([
    fetchAmgTimecardSheets(session, weekStart, weekEnd(weekStart), Array.from(wantedCodes)),
    // Remembered one at a time — each is a read-modify-write of the roster.
    (async () => {
      for (const employee of newlyLinked) await upsertCloudEmployee(employee);
    })()
  ]);

  for (const [employeeId, code] of codeFor) {
    const sheet = sheets.get(code);
    results.set(
      employeeId,
      sheet ? { ok: true, sheet } : { ok: false, error: "not-matched", detail: `AMG returned no timecard for code ${code}.` }
    );
  }
  // Same-name records: the one with hours this week is the person. Not
  // remembered on the roster — next week the other record could be the live
  // one — so it's decided fresh on every pull.
  for (const [employeeId, { codes, reason }] of ambiguous) {
    const withHours = codes.filter((code) => paidHours(sheets.get(code)) > 0);
    const sheet = withHours.length === 1 ? sheets.get(withHours[0]) : undefined;
    const why = withHours.length === 0 ? "None of them has hours this week." : "More than one of them has hours this week.";
    results.set(employeeId, sheet ? { ok: true, sheet } : { ok: false, error: "not-matched", detail: `${why} ${reason}` });
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
    if (!result || !result.ok) {
      return NextResponse.json({ error: "not-matched", detail: result && !result.ok ? result.detail : undefined }, { status: 404 });
    }
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
