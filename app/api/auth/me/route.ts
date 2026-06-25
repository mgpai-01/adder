import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";

// Returns the signed-in user's profile (role/username) using the service-role
// client so it works regardless of row-level-security rules.
export async function GET(request: Request) {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ profile: null, configured: false });
  }

  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return NextResponse.json({ profile: null });
  }

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) {
    return NextResponse.json({ profile: null });
  }

  // manager_yard may not exist on older databases; fall back without it.
  let { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, username, full_name, role, active, manager_yard")
    .eq("id", userData.user.id)
    .single();
  if (profileError && /manager_yard/i.test(profileError.message)) {
    ({ data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, username, full_name, role, active")
      .eq("id", userData.user.id)
      .single());
  }

  if (profileError || !profile) {
    return NextResponse.json({ profile: null });
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
