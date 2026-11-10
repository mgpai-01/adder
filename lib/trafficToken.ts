import { createHmac, timingSafeEqual } from "node:crypto";

// Traffic images are drawn by the browser as map tiles, and an <img> can't
// send our sign-in header. So instead of handing the browser the TomTom key,
// /api/samsara/traffic gives a signed, short-lived pass, and the tile route
// (/api/samsara/traffic/tile/...) checks it and fetches the image from
// TomTom itself. The key never leaves the server. Server-only module.

export const TRAFFIC_TOKEN_MS = 6 * 60 * 60 * 1000;

function secret(): string {
  return `mgp-traffic-tiles:${process.env.TOMTOM_API_KEY ?? ""}`;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

// "<userId>.<expiresMs>.<signature>"
export function issueTrafficToken(userId: string): { token: string; expiresAt: number } {
  const expiresAt = Date.now() + TRAFFIC_TOKEN_MS;
  const payload = `${userId}.${expiresAt}`;
  return { token: `${payload}.${sign(payload)}`, expiresAt };
}

// The user id the pass was issued to, or null if it's forged or expired.
export function checkTrafficToken(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, expires, signature] = parts;
  const expiresAt = Number(expires);
  if (!userId || !Number.isFinite(expiresAt) || expiresAt < Date.now()) return null;
  const expected = Buffer.from(sign(`${userId}.${expires}`));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return userId;
}
