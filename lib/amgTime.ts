// Server-side client for the AMG Time Universal API (amgwebtime.com).
//
// Auth is cookie-based: POST /JsonApi/TimeCard/Login with the userName as a
// query parameter and the password as a JSON string body; every cookie the
// response sets must accompany subsequent requests. Credentials live in the
// AMG_USERNAME / AMG_PASSWORD environment variables (Vercel project settings)
// and never leave the server.
//
// The shapes here mirror the swagger spec saved in docs/amg-api-notes.md.

import type { ImportedBlock } from "./hoursImport";

const AMG_HOST = process.env.AMG_HOST || "https://amgwebtime.com";

type AmgEmployeeShort = {
  Id: number;
  Code?: string;
  Name?: string;
  FullName?: string;
  LastName?: string;
  Active?: boolean;
};

type AmgTimecardLine = {
  Date?: string;
  Reg?: number;
  OT1?: number;
  OT2?: number;
  OT3?: number;
  Unpaid?: number;
  IsMissing?: boolean;
  // Present when the line is a miscellaneous transaction (bonus hours, pay
  // adjustments) rather than punched work time. Those lines are excluded so
  // synced hours match the plain (no-bonus) Timecard report.
  MiscEntry?: { CategoryId?: number; Hours?: number; Amount?: number } | null;
};

type AmgEmployeeTimecards = {
  EmployeeId: number;
  Timecards?: AmgTimecardLine[];
};

export function isAmgConfigured(): boolean {
  return Boolean(process.env.AMG_USERNAME && process.env.AMG_PASSWORD);
}

// Logs into AMG and returns the session cookies to send with every call.
async function amgLogin(): Promise<string> {
  const userName = process.env.AMG_USERNAME ?? "";
  const password = process.env.AMG_PASSWORD ?? "";
  const response = await fetch(`${AMG_HOST}/JsonApi/TimeCard/Login?userName=${encodeURIComponent(userName)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(password),
    redirect: "manual"
  });
  if (!response.ok && response.status !== 204) {
    throw new Error(`AMG login failed (${response.status}). Check AMG_USERNAME / AMG_PASSWORD in Vercel.`);
  }
  // Node's fetch exposes every Set-Cookie header via getSetCookie().
  const setCookies: string[] =
    typeof (response.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === "function"
      ? (response.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
      : response.headers.get("set-cookie")
        ? [response.headers.get("set-cookie") as string]
        : [];
  const cookie = setCookies.map((item) => item.split(";")[0]).join("; ");
  if (!cookie) throw new Error("AMG login returned no session cookie — the username or password is likely wrong.");
  return cookie;
}

async function amgPost<T>(cookie: string, path: string, body: unknown): Promise<T> {
  const response = await fetch(`${AMG_HOST}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`AMG ${path} failed (${response.status}).`);
  }
  return (await response.json()) as T;
}

// The date part AMG expects on its date-time query parameters.
function amgDate(iso: string): string {
  return `${iso}T00:00:00`;
}

// ===== Live per-person time sheet, laid out like AMG's printed Timecard =====

type AmgPunch = {
  Action?: number; // 2 Out For Lunch, 3 In From Lunch, 4 Out For Break, 5 In From Break, 6 Clock In, 7 Clock Out
  ClockDate?: string;
  JobId?: number;
};

type AmgEmployeeTransactions = {
  EmployeeId: number;
  Transactions?: AmgPunch[];
};

type AmgEmployeeWage = {
  EmployeeId: number;
  Wages?: Array<{ Amount?: number; StartDate?: string; Type?: number }>;
};

type AmgJob = { Id?: number; Code?: string; Name?: string };

export type TimecardSegment = {
  cat: "WORK" | "BRK" | "LUNCH";
  start: string;
  stop: string;
  job: string;
  hours: number;
  reg: number;
  ot1: number;
  ot2: number;
  unpaid: number;
  total: number;
};

export type TimecardDay = {
  date: string;
  absent: boolean;
  segments: TimecardSegment[];
  summary: { hours: number; reg: number; ot1: number; ot2: number; unpaid: number; total: number };
};

export type TimecardSheet = {
  code: string;
  name: string;
  jobLabel: string;
  days: TimecardDay[];
  totals: { hours: number; reg: number; ot1: number; ot2: number; unpaid: number; total: number };
  wage: { rate: number; ot1Rate: number; ot2Rate: number; regPay: number; ot1Pay: number; ot2Pay: number; gross: number } | null;
};

function clockLabel(dateTime: string): string {
  const match = /T(\d{2}):(\d{2})/.exec(dateTime);
  if (!match) return "";
  let hours = Number(match[1]);
  const suffix = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  return `${hours}:${match[2]} ${suffix}`;
}

function hoursBetween(start: string, stop: string): number {
  const ms = new Date(stop).getTime() - new Date(start).getTime();
  return Math.max(0, Math.round((ms / 3600000) * 100) / 100);
}

const round2 = (value: number) => Math.round(value * 100) / 100;

// Every AMG employee's code and name — for matching roster people to their
// AMG record by name when no code is remembered yet.
export async function fetchAmgEmployeeDirectory(): Promise<Array<{ code: string; name: string }>> {
  const cookie = await amgLogin();
  const employees = await amgPost<AmgEmployeeShort[]>(cookie, "/JsonApi/Employee/GetAllEmployeesShort", null);
  return employees
    .filter((employee) => (employee.Code ?? "").trim())
    .map((employee) => ({
      code: (employee.Code ?? "").trim(),
      name: (employee.FullName ?? employee.Name ?? "").replace(/\s+/g, " ").trim()
    }));
}

// Builds one person's week exactly the way AMG's Timecard report shows it:
// WORK/BRK/LUNCH segments from their punches, day summary lines straight from
// AMG's own daily totals, the wage line from their wage on file. Bonus/misc
// lines are excluded (the plain, no-bonus report). The per-segment REG/OT
// split fills the day's REG bucket in clock order, then OT1, then OT2 — the
// same way the printed report lays overtime at the end of the day.
export async function fetchAmgTimecardSheet(startDate: string, endDate: string, code: string): Promise<TimecardSheet | null> {
  const cookie = await amgLogin();
  const employees = await amgPost<AmgEmployeeShort[]>(cookie, "/JsonApi/Employee/GetAllEmployeesShort", null);
  const employee = employees.find((item) => (item.Code ?? "").trim() === code);
  if (!employee) return null;
  const ids = [employee.Id];

  const range = `startDate=${encodeURIComponent(amgDate(startDate))}&endDate=${encodeURIComponent(amgDate(endDate))}`;
  const [timecards, transactions, wages] = await Promise.all([
    amgPost<AmgEmployeeTimecards[]>(cookie, `/JsonApi/TimeCard/GetTimecards?${range}&showAbsences=true`, ids),
    amgPost<AmgEmployeeTransactions[]>(cookie, `/JsonApi/Transaction/GetTransactions?${range}`, ids).catch(() => []),
    amgPost<AmgEmployeeWage[]>(cookie, "/JsonApi/Wage/GetEmployeeWages", ids).catch(() => [])
  ]);

  // AMG's own daily totals (and absence markers), bonus lines excluded.
  const dayTotals = new Map<string, { reg: number; ot1: number; ot2: number; unpaid: number; absent: boolean }>();
  const jobIds = new Set<number>();
  for (const line of timecards.find((item) => item.EmployeeId === employee.Id)?.Timecards ?? []) {
    if (!line.Date || line.MiscEntry) continue;
    const date = line.Date.slice(0, 10);
    const bucket = dayTotals.get(date) ?? { reg: 0, ot1: 0, ot2: 0, unpaid: 0, absent: false };
    if (line.IsMissing) {
      bucket.absent = bucket.reg + bucket.ot1 + bucket.ot2 === 0;
    } else {
      bucket.reg += line.Reg ?? 0;
      bucket.ot1 += line.OT1 ?? 0;
      bucket.ot2 += (line.OT2 ?? 0) + (line.OT3 ?? 0);
      bucket.unpaid += line.Unpaid ?? 0;
      bucket.absent = false;
    }
    dayTotals.set(date, bucket);
    const jobId = (line as { JobId?: number }).JobId;
    if (typeof jobId === "number" && jobId > 0) jobIds.add(jobId);
  }

  // Punches, grouped per day in clock order, turned into report segments.
  const punchesByDay = new Map<string, AmgPunch[]>();
  for (const punch of transactions.find((item) => item.EmployeeId === employee.Id)?.Transactions ?? []) {
    if (!punch.ClockDate || typeof punch.Action !== "number") continue;
    if (![2, 3, 4, 5, 6, 7, 10, 11].includes(punch.Action)) continue;
    const date = punch.ClockDate.slice(0, 10);
    const list = punchesByDay.get(date) ?? [];
    list.push(punch);
    punchesByDay.set(date, list);
    if (typeof punch.JobId === "number" && punch.JobId > 0) jobIds.add(punch.JobId);
  }

  // Job label for the header + segment rows, e.g. "(00015) SULTANA-REPAIRER".
  let jobLabel = "";
  let jobCode = "";
  if (jobIds.size > 0) {
    const jobs = await amgPost<AmgJob[]>(cookie, "/JsonApi/Job/GetJobs", Array.from(jobIds)).catch(() => [] as AmgJob[]);
    const first = jobs[0];
    if (first) {
      jobCode = (first.Code ?? "").trim();
      jobLabel = `(${jobCode}) ${(first.Name ?? "").trim()}`.trim();
    }
  }

  const days: TimecardDay[] = [];
  const dates = Array.from(new Set([...dayTotals.keys(), ...punchesByDay.keys()])).sort();
  for (const date of dates) {
    const totals = dayTotals.get(date) ?? { reg: 0, ot1: 0, ot2: 0, unpaid: 0, absent: false };
    const punches = (punchesByDay.get(date) ?? []).sort((a, b) => (a.ClockDate ?? "").localeCompare(b.ClockDate ?? ""));

    const segments: TimecardSegment[] = [];
    let regLeft = totals.reg;
    let ot1Left = totals.ot1;
    for (let index = 0; index < punches.length - 1; index++) {
      const punch = punches[index];
      const next = punches[index + 1];
      if (punch.Action === 7) continue; // clocked out — no segment until the next clock-in
      const cat: TimecardSegment["cat"] = punch.Action === 2 ? "LUNCH" : punch.Action === 4 ? "BRK" : "WORK";
      const hours = hoursBetween(punch.ClockDate as string, next.ClockDate as string);
      if (hours <= 0) continue;
      if (cat === "LUNCH") {
        segments.push({ cat, start: clockLabel(punch.ClockDate as string), stop: clockLabel(next.ClockDate as string), job: jobCode, hours, reg: 0, ot1: 0, ot2: 0, unpaid: hours, total: 0 });
        continue;
      }
      const reg = round2(Math.min(hours, Math.max(0, regLeft)));
      regLeft = round2(regLeft - reg);
      const ot1 = round2(Math.min(hours - reg, Math.max(0, ot1Left)));
      ot1Left = round2(ot1Left - ot1);
      const ot2 = round2(Math.max(0, hours - reg - ot1));
      segments.push({ cat, start: clockLabel(punch.ClockDate as string), stop: clockLabel(next.ClockDate as string), job: jobCode, hours, reg, ot1, ot2, unpaid: 0, total: hours });
    }

    const paid = round2(totals.reg + totals.ot1 + totals.ot2);
    days.push({
      date,
      absent: totals.absent && segments.length === 0,
      segments,
      summary: {
        hours: round2(paid + totals.unpaid),
        reg: round2(totals.reg),
        ot1: round2(totals.ot1),
        ot2: round2(totals.ot2),
        unpaid: round2(totals.unpaid),
        total: paid
      }
    });
  }

  const totals = days.reduce(
    (sum, day) => ({
      hours: round2(sum.hours + day.summary.hours),
      reg: round2(sum.reg + day.summary.reg),
      ot1: round2(sum.ot1 + day.summary.ot1),
      ot2: round2(sum.ot2 + day.summary.ot2),
      unpaid: round2(sum.unpaid + day.summary.unpaid),
      total: round2(sum.total + day.summary.total)
    }),
    { hours: 0, reg: 0, ot1: 0, ot2: 0, unpaid: 0, total: 0 }
  );

  // Current hourly wage on file → the report's Wage / Total Gross Paid lines.
  let wage: TimecardSheet["wage"] = null;
  const wageRows = (wages.find((item) => item.EmployeeId === employee.Id)?.Wages ?? [])
    .filter((item) => (item.Type ?? 1) === 1 && typeof item.Amount === "number" && (item.Amount ?? 0) > 0)
    .sort((a, b) => (b.StartDate ?? "").localeCompare(a.StartDate ?? ""));
  const rate = wageRows[0]?.Amount ?? 0;
  if (rate > 0) {
    const ot1Rate = round2(rate * 1.5);
    const ot2Rate = round2(rate * 2);
    const regPay = round2(totals.reg * rate);
    const ot1Pay = round2(totals.ot1 * ot1Rate);
    const ot2Pay = round2(totals.ot2 * ot2Rate);
    wage = { rate, ot1Rate, ot2Rate, regPay, ot1Pay, ot2Pay, gross: round2(regPay + ot1Pay + ot2Pay) };
  }

  return {
    code,
    name: (employee.FullName ?? employee.Name ?? "").replace(/\s+/g, " ").trim(),
    jobLabel,
    days,
    totals,
    wage
  };
}

// Pulls every active employee's daily paid hours from AMG for the given range
// (ISO yyyy-mm-dd, inclusive), in the same block shape the file importer
// produces — code, name, and per-day totals (Reg + OT levels). Bonus/misc
// lines are excluded, so the figures match the plain (no-bonus) Timecard
// report's "Total" column — worked time only.
export async function fetchAmgHours(startDate: string, endDate: string): Promise<ImportedBlock[]> {
  const cookie = await amgLogin();

  const employees = await amgPost<AmgEmployeeShort[]>(cookie, "/JsonApi/Employee/GetAllEmployeesShort", null);
  const active = employees.filter((employee) => employee.Active !== false);
  if (active.length === 0) return [];

  // The full (non-Lite) feed is used because only it carries MiscEntry, the
  // marker that a line is a bonus/adjustment rather than punched work time.
  const timecards = await amgPost<AmgEmployeeTimecards[]>(
    cookie,
    `/JsonApi/TimeCard/GetTimecards?startDate=${encodeURIComponent(amgDate(startDate))}&endDate=${encodeURIComponent(
      amgDate(endDate)
    )}&showAbsences=false`,
    active.map((employee) => employee.Id)
  );

  const byId = new Map(active.map((employee) => [employee.Id, employee]));
  const blocks: ImportedBlock[] = [];
  for (const record of timecards) {
    const employee = byId.get(record.EmployeeId);
    if (!employee) continue;
    // Several timecard lines can land on the same day (split shifts); sum them.
    const dayTotals = new Map<string, { hours: number; ot1: number; ot2: number }>();
    for (const line of record.Timecards ?? []) {
      if (!line.Date || line.IsMissing) continue;
      // Bonus and other pay adjustments come through as misc-transaction
      // lines; only punched work time counts toward the day's hours.
      if (line.MiscEntry) continue;
      const date = line.Date.slice(0, 10);
      const hours = (line.Reg ?? 0) + (line.OT1 ?? 0) + (line.OT2 ?? 0) + (line.OT3 ?? 0);
      if (hours <= 0) continue;
      const bucket = dayTotals.get(date) ?? { hours: 0, ot1: 0, ot2: 0 };
      bucket.hours += hours;
      bucket.ot1 += line.OT1 ?? 0;
      bucket.ot2 += (line.OT2 ?? 0) + (line.OT3 ?? 0);
      dayTotals.set(date, bucket);
    }
    if (dayTotals.size === 0) continue;
    blocks.push({
      code: (employee.Code ?? String(employee.Id)).trim(),
      name: (employee.FullName ?? employee.Name ?? "").replace(/\s+/g, " ").trim(),
      days: Array.from(dayTotals.entries())
        .map(([date, totals]) => ({
          date,
          hours: Number(totals.hours.toFixed(2)),
          ot1: Number(totals.ot1.toFixed(2)),
          ot2: Number(totals.ot2.toFixed(2))
        }))
        .sort((a, b) => a.date.localeCompare(b.date))
    });
  }
  return blocks.sort((a, b) => a.code.localeCompare(b.code));
}
