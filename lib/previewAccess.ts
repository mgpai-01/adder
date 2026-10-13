// Features still being tried out, shown only to the logins listed here until
// they're ready for everyone. Emails are compared lowercase.

// Samsara fleet map (trucks + trailers).
const SAMSARA_PREVIEW_EMAILS = ["mgpai@palletmail.com"];

export function canSeeSamsaraPreview(email: string | null | undefined): boolean {
  return SAMSARA_PREVIEW_EMAILS.includes((email ?? "").trim().toLowerCase());
}
