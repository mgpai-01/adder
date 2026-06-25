import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Returns the signed-in user's profile (role/username) using the service-role
// client so it works regardless of row-level-security rules.
export async function GET(request: Request) {
  const supabase = getSupabaseServerClient();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabase || !url || !anonKey) {
    return NextResponse.json({ profile: null, reason: "server-not-configured" });
  }

  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return NextResponse.json({ profile: null, reason: "no-token" });
  }

  // Validate the token by calling GoTrue directly with the public key. We avoid
  // supabase.auth.getUser(token) here: on a client created with the service-role
  // key it looks for a stored session instead of verifying the passed token and
  // fails with "Auth session missing!". This REST call verifies the token and
  // returns the user, and the service-role client below does the DB read.
  let userId = "";
  try {
    const userRes = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
      cache: "no-store"
    });
    if (!userRes.ok) {
      return NextResponse.json({ profile: null, reason: `auth: HTTP ${userRes.status}` });
    }
    const user = (await userRes.json()) as { id?: string };
    userId = user.id ?? "";
  } catch (caught) {
    return NextResponse.json({ profile: null, reason: `auth: ${(caught as Error)?.message ?? "verify failed"}` });
  }
  if (!userId) {
    return NextResponse.json({ profile: null, reason: "auth: no user id" });
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
