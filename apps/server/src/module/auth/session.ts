import crypto from "crypto";

// Session lifetime: also used as the login cookie's maxAge.
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export const SESSION_COOKIE_NAME = "pp_session";

// Helper function: Fast SHA-256 hash for secure token lookups
function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Create session: Generates a random 32-byte cryptographically secure token,
 * hashes it, and returns both the unhashed token (for the cookie) and the hash 
 * (for the DB record).
 */
export function generateSessionData() {
  // Generate 32 cryptographically secure random bytes
  const rawToken = crypto.randomBytes(32).toString("hex");
  const hashedToken = hashToken(rawToken);

  return {
    rawToken,     // Send this back to the caller to set as the HTTP-only cookie
    hashedToken,  // Save this hash in your database
  };
}

/**
 * Find session: Hashes the incoming token from the cookie to look it up in your DB.
 * 
 * Note: When implementing your DB query, ensure you add a condition to check 
 * if the current time is less than the session's expiry time. 
 * If missing or expired, return null.
 */
export function getHashedTokenForLookup(rawToken: string): string {
  return hashToken(rawToken);
}

/**
 * Delete one session
 * Implementation example for your database layer:
 * 
 * async function deleteSession(hashedToken: string) {
 *   await db.session.delete({ where: { tokenHash: hashedToken } });
 * }
 */

/**
 * Delete all sessions for a user (Crucial for M9 account freezing/banning)
 * Implementation example for your database layer:
 * 
 * async function deleteAllSessionsForUser(userId: string) {
 *   await db.session.deleteMany({ where: { userId } });
 * }
 */
