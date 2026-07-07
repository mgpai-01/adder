import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { verifyUserToken } from "@/lib/verifyToken";

export const dynamic = "force-dynamic";

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

  const check = await verifyUserToken(token);
  if (!check) {
    return NextResponse.json({ profile: null, reason: "auth: token rejected" });
  }
  const userId = check.userId;

  // manager_yard / preferred_language may not exist on older databases; fall
  // back progressively without them. maybeSingle so a genuinely-missing row
  // reports as a missing row rather than a query error, which keeps the
  // diagnostic reason accurate.
  let { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, username, full_name, role, active, manager_yard, preferred_language")
    .eq("id", userId)
    .maybeSingle();
  if (profileError && /preferred_language/i.test(profileError.message)) {
    ({ data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, username, full_name, role, active, manager_yard")
      .eq("id", userId)
      .maybeSingle());
  }
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
    tokenCheck: check.method,
    profile: {
      id: profile.id,
      username: profile.username ?? "",
      fullName: profile.full_name,
      role: profile.role,
      active: profile.active,
      managerYard: (profile as { manager_yard?: string | null }).manager_yard ?? "",
      preferredLanguage: (profile as { preferred_language?: string | null }).preferred_language ?? ""
    }
  });
}
