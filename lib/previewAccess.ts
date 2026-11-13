// Who may see the Samsara fleet features (Fleet tab: truck and trailer
// locations, ETAs, traffic). Decided on the server — the browser asks
// /api/samsara/access, and every Samsara route checks the same rule.
//
// Admins and managers, on the live app and on test (Vercel Preview)
// deployments alike: test links use the same accounts as the live app, so
// counter (employee) logins must not see locations there either. Emails listed below also get access
// whatever their role. Emails are compared lowercase.

const SAMSARA_EXTRA_EMAILS = ["mgpai@palletmail.com"];
// Admins and managers ("supervisor" in the database; "Manager" in the app).
const SAMSARA_ROLES = ["admin", "supervisor"];

export function isTestDeployment(): boolean {
  return process.env.VERCEL_ENV === "preview";
}

export function canSeeSamsaraPreview(email: string | null | undefined, role: string | null | undefined): boolean {
  if (SAMSARA_EXTRA_EMAILS.includes((email ?? "").trim().toLowerCase())) return true;
  return SAMSARA_ROLES.includes(role ?? "");
}
