// Features still being tried out. On the live app they're shown only to the
// logins listed here; on a test (Vercel Preview) deployment every admin sees
// them, so a test link can be shared with other admins for feedback. (Test
// links use the same accounts as the live app, so this keeps truck and
// trailer locations away from employee logins there too.) Emails are
// compared lowercase.
//
// Server-only rule: VERCEL_ENV is "production" on the live app and "preview"
// on test deployments. The browser asks /api/samsara/access rather than
// deciding for itself.

// Samsara fleet map (trucks + trailers).
const SAMSARA_PREVIEW_EMAILS = ["mgpai@palletmail.com"];

export function isTestDeployment(): boolean {
  return process.env.VERCEL_ENV === "preview";
}

// Roles that may see it on a test deployment.
const SAMSARA_TEST_ROLES = ["admin"];

export function canSeeSamsaraPreview(email: string | null | undefined, role: string | null | undefined): boolean {
  if (SAMSARA_PREVIEW_EMAILS.includes((email ?? "").trim().toLowerCase())) return true;
  return isTestDeployment() && SAMSARA_TEST_ROLES.includes(role ?? "");
}
