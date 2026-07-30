import { NextResponse } from "next/server";
import { isCloudRosterConfigured, readCloudEmployees, readCloudEmployeesSummary, upsertCloudEmployee } from "@/lib/cloudEmployees";
import type { Employee } from "@/lib/types";
import { denyUnless } from "@/lib/apiAuth";

export async function GET(request: Request) {
  if (!isCloudRosterConfigured()) {
    return NextResponse.json({ employees: [], storage: "local" });
  }
  // `?summary=1` returns the roster without base64 profile photos, to save
  // egress on always-on displays like the live board. That summary (name and
  // photo) is all the public board may read; the full record — payroll id,
  // station, yard assignment — needs a session.
  const summary = new URL(request.url).searchParams.get("summary") === "1";
  if (!summary && (await denyUnless(request))) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const employees = summary ? await readCloudEmployeesSummary() : await readCloudEmployees();
  return NextResponse.json({ employees, storage: "cloud" });
}

export async function POST(request: Request) {
  const denied = await denyUnless(request, ["admin"]);
  if (denied) return denied;

  const employee = (await request.json()) as Employee;
  const result = await upsertCloudEmployee(employee);
  return NextResponse.json({ ok: result.ok, employee, error: result.error });
}
