import { createRemoteJWKSet, jwtVerify } from "jose";

// Verifies a Supabase access token (signature + expiry) and returns the user id
// (the `sub` claim). Handles both project setups:
//   - asymmetric "JWT signing keys" -> verified against the project's JWKS
//   - legacy shared "JWT secret" (HS256) -> verified with SUPABASE_JWT_SECRET
// Returns null if the token can't be verified — there is no unverified fallback.

export type TokenCheck = { userId: string; verified: boolean; method: "jwks" | "hs256" };

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

let jwksSet: ReturnType<typeof createRemoteJWKSet> | null = null;
function getJwks() {
  if (!supabaseUrl) return null;
  if (!jwksSet) {
    try {
      jwksSet = createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`));
    } catch {
      jwksSet = null;
    }
  }
  return jwksSet;
}

export async function verifyUserToken(token: string): Promise<TokenCheck | null> {
  if (!token) return null;

  // 1) Asymmetric signing keys (modern Supabase): verify against JWKS.
  const jwks = getJwks();
  if (jwks) {
    try {
      const { payload } = await jwtVerify(token, jwks);
      if (payload.sub) return { userId: String(payload.sub), verified: true, method: "jwks" };
    } catch {
      // Not asymmetric (or wrong key) — fall through to the shared secret.
    }
  }

  // 2) Legacy shared HS256 secret.
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (secret) {
    try {
      const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
      if (payload.sub) return { userId: String(payload.sub), verified: true, method: "hs256" };
    } catch {
      // Wrong/missing secret — fall through to the temporary decode fallback.
    }
  }

  // Could not verify with either method — reject.
  return null;
}
