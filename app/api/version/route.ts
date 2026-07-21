import { NextResponse } from "next/server";

// Reports the commit the currently-serving deployment was built from. The
// client compares this against the commit baked into its own bundle to detect
// version skew (an old tab still open after a new deploy). A free, in-app
// stand-in for Vercel's paid Skew Protection.
//
// Also handy for confirming a deploy is current: open /api/version in a browser
// and check `buildId` against the latest commit — `ref` (branch) and `message`
// (commit subject) make it human-readable at a glance.
export const dynamic = "force-dynamic";

export function GET() {
  const buildId = process.env.VERCEL_GIT_COMMIT_SHA || "dev";
  const ref = process.env.VERCEL_GIT_COMMIT_REF || "";
  const message = process.env.VERCEL_GIT_COMMIT_MESSAGE || "";
  return NextResponse.json(
    { buildId, ref, message },
    { headers: { "Cache-Control": "no-store" } }
  );
}
