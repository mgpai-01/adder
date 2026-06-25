import { NextResponse } from "next/server";

// Reports the commit the currently-serving deployment was built from. The
// client compares this against the commit baked into its own bundle to detect
// version skew (an old tab still open after a new deploy). A free, in-app
// stand-in for Vercel's paid Skew Protection.
export const dynamic = "force-dynamic";

export function GET() {
  const buildId = process.env.VERCEL_GIT_COMMIT_SHA || "dev";
  return NextResponse.json(
    { buildId },
    { headers: { "Cache-Control": "no-store" } }
  );
}
