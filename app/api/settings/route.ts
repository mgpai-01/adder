import { NextResponse } from "next/server";
import { readLocalSettings, writeLocalSettings } from "@/lib/localSettings";
import type { PayrollSettings } from "@/lib/types";
import { denyUnless } from "@/lib/apiAuth";

export async function GET() {
  const settings = await readLocalSettings();
  return NextResponse.json({ settings });
}

export async function POST(request: Request) {
  const denied = await denyUnless(request, ["admin"]);
  if (denied) return denied;

  const settings = (await request.json()) as PayrollSettings;
  const saved = await writeLocalSettings(settings);
  return NextResponse.json({ settings: saved });
}
