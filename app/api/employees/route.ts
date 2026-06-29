import { NextResponse } from "next/server";
import { isCloudRosterConfigured, readCloudEmployees, readCloudEmployeesSummary, upsertCloudEmployee } from "@/lib/cloudEmployees";
import type { Employee } from "@/lib/types";

export async function GET(request: Request) {
  if (!isCloudRosterConfigured()) {
    return NextResponse.json({ employees: [], storage: "local" });
  }
  // `?summary=1` returns the roster without base64 profile photos, to save
  // egress on always-on displays like the live board.
  const summary = new URL(request.url).searchParams.get("summary") === "1";
  const employees = summary ? await readCloudEmployeesSummary() : await readCloudEmployees();
  return NextResponse.json({ employees, storage: "cloud" });
}

export async function POST(request: Request) {
  const employee = (await request.json()) as Employee;
  const result = await upsertCloudEmployee(employee);
  return NextResponse.json({ ok: result.ok, employee, error: result.error });
}
