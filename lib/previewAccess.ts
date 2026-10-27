// Features still being tried out. On the live app they're shown only to the
// logins listed here; on a test (Vercel Preview) deployment every signed-in
// user sees them, so a test link can be shared for feedback. Emails are
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

export function canSeeSamsaraPreview(email: string | null | undefined): boolean {
  return isTestDeployment() || SAMSARA_PREVIEW_EMAILS.includes((email ?? "").trim().toLowerCase());
}
