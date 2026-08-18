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

// Pulls every active employee's daily paid hours from AMG for the given range
// (ISO yyyy-mm-dd, inclusive), in the same block shape the file importer
// produces — code, name, and per-day totals (Reg + OT levels; the same figure
// the Timecard report prints in its "Total" column).
export async function fetchAmgHours(startDate: string, endDate: string): Promise<ImportedBlock[]> {
  const cookie = await amgLogin();

  const employees = await amgPost<AmgEmployeeShort[]>(cookie, "/JsonApi/Employee/GetAllEmployeesShort", null);
  const active = employees.filter((employee) => employee.Active !== false);
  if (active.length === 0) return [];

  const timecards = await amgPost<AmgEmployeeTimecards[]>(
    cookie,
    `/JsonApi/TimeCard/GetTimecardsLite?startDate=${encodeURIComponent(amgDate(startDate))}&endDate=${encodeURIComponent(
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
