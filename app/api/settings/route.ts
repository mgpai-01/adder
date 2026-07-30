import { NextResponse } from "next/server";
import { readLocalSettings, writeLocalSettings } from "@/lib/localSettings";
import type { PayrollSettings } from "@/lib/types";
import { denyUnless } from "@/lib/apiAuth";

export async function GET(request: Request) {
  const settings = await readLocalSettings();
  // The live board runs signed out and only needs the production goal to draw
  // its progress bars. Wage and overtime figures stay behind a session.
  if (await denyUnless(request)) {
    return NextResponse.json({ settings: { dailyProductionGoal: settings.dailyProductionGoal } });
  }
  return NextResponse.json({ settings });
}

export async function POST(request: Request) {
  const denied = await denyUnless(request, ["admin"]);
  if (denied) return denied;

  const settings = (await request.json()) as PayrollSettings;
  const saved = await writeLocalSettings(settings);
  return NextResponse.json({ settings: saved });
}
