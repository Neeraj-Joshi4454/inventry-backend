import { randomBytes, createHmac, timingSafeEqual } from 'crypto';
import { env } from '../config/env';

/**
 * Refresh tokens use a "selector:validator" opaque-token pattern, not a JWT:
 *   <sessionId>:<random-secret>
 * - `sessionId` (the RefreshToken document's _id) lets the server look up
 *   the session in O(1) without scanning/comparing against every stored hash.
 * - `secret` is high-entropy random data; only its HMAC is stored
 *   (RefreshToken.tokenHash), so a database read alone never yields a
 *   usable token — matches the "do not store raw refresh tokens" requirement.
 *
 * HMAC (keyed with JWT_REFRESH_SECRET) is used instead of a bare hash so
 * that even if this hashing scheme were ever run against lower-entropy
 * input elsewhere, it wouldn't be precomputable offline.
 */
const SECRET_BYTES = 40;

export function generateRefreshSecret(): string {
  return randomBytes(SECRET_BYTES).toString('base64url');
}

export function hashRefreshSecret(secret: string): string {
  return createHmac('sha256', env.JWT_REFRESH_SECRET).update(secret).digest('hex');
}

export function buildRefreshToken(sessionId: string, secret: string): string {
  return `${sessionId}:${secret}`;
}

export function parseRefreshToken(token: string): { sessionId: string; secret: string } | null {
  const separatorIndex = token.indexOf(':');
  if (separatorIndex <= 0 || separatorIndex === token.length - 1) return null;
  return {
    sessionId: token.slice(0, separatorIndex),
    secret: token.slice(separatorIndex + 1),
  };
}

/** Constant-time comparison — never use === on secret material. */
export function safeCompareHash(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
