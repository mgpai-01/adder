import { NextResponse } from "next/server";
import { insertChangeLog, readChangeLog, type ChangeLogEntry } from "@/lib/cloudChangeLog";
import { denyUnless } from "@/lib/apiAuth";

export async function GET(request: Request) {
  const denied = await denyUnless(request);
  if (denied) return denied;

  const entries = await readChangeLog();
  return NextResponse.json({ entries });
}

export async function POST(request: Request) {
  const denied = await denyUnless(request);
  if (denied) return denied;

  const entry = (await request.json()) as ChangeLogEntry;
  const result = await insertChangeLog(entry);
  return NextResponse.json({ ok: result.ok, error: result.error });
}
