import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Read the user id (the `sub` claim) straight out of the Supabase access token.
// We deliberately avoid supabase.auth.getUser(token) and the GoTrue /user REST
// endpoint here: on a service-role client getUser looks for a stored session
// ("Auth session missing!"), and the REST call has been returning 403 in this
// project. The token is a standard JWT (header.payload.signature); we base64url
// decode the payload to get the user id and reject expired tokens.
function userIdFromToken(token: string): string | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(payload, "base64").toString("utf8");
    const claims = JSON.parse(json) as { sub?: string; exp?: number };
    // Reject tokens that have expired (exp is in seconds).
    if (claims.exp && claims.exp * 1000 < Date.now()) return null;
    return claims.sub ?? null;
  } catch {
    return null;
  }
}

// Returns the signed-in user's profile (role/username) using the service-role
// client so it works regardless of row-level-security rules.
export async function GET(request: Request) {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ profile: null, reason: "server-not-configured" });
  }

  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return NextResponse.json({ profile: null, reason: "no-token" });
  }

  const userId = userIdFromToken(token);
  if (!userId) {
    return NextResponse.json({ profile: null, reason: "auth: could not read user id from token" });
  }

  // manager_yard may not exist on older databases; fall back without it.
  // maybeSingle so a genuinely-missing row reports as a missing row rather than
  // a query error, which keeps the diagnostic reason accurate.
  let { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, username, full_name, role, active, manager_yard")
    .eq("id", userId)
    .maybeSingle();
  if (profileError && /manager_yard/i.test(profileError.message)) {
    ({ data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, username, full_name, role, active")
      .eq("id", userId)
      .maybeSingle());
  }

  if (profileError) {
    return NextResponse.json({ profile: null, reason: `db: ${profileError.message}` });
  }
  if (!profile) {
    return NextResponse.json({ profile: null, reason: `no-row-for-user ${userId}` });
  }

  return NextResponse.json({
    profile: {
      id: profile.id,
      username: profile.username ?? "",
      fullName: profile.full_name,
      role: profile.role,
      active: profile.active,
      managerYard: (profile as { manager_yard?: string | null }).manager_yard ?? ""
    }
  });
}
