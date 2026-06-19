import { NextResponse } from "next/server";
import { insertChangeLog, readChangeLog, type ChangeLogEntry } from "@/lib/cloudChangeLog";

export async function GET() {
  const entries = await readChangeLog();
  return NextResponse.json({ entries });
}

export async function POST(request: Request) {
  const entry = (await request.json()) as ChangeLogEntry;
  const result = await insertChangeLog(entry);
  return NextResponse.json({ ok: result.ok, error: result.error });
}
