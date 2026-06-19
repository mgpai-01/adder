import { NextResponse } from "next/server";
import { isCloudRosterConfigured, readCloudEmployees, upsertCloudEmployee } from "@/lib/cloudEmployees";
import type { Employee } from "@/lib/types";

export async function GET() {
  if (!isCloudRosterConfigured()) {
    return NextResponse.json({ employees: [], storage: "local" });
  }
  const employees = await readCloudEmployees();
  return NextResponse.json({ employees, storage: "cloud" });
}

export async function POST(request: Request) {
  const employee = (await request.json()) as Employee;
  const result = await upsertCloudEmployee(employee);
  return NextResponse.json({ ok: result.ok, employee, error: result.error });
}
