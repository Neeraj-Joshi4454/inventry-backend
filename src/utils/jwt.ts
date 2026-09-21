import jwt, { type SignOptions } from 'jsonwebtoken';
import type { Types } from 'mongoose';
import { env } from '../config/env';
import type { UserRole } from '../types/enums';

/**
 * Access tokens are the only JWT in this system. Refresh tokens are opaque,
 * DB-backed sessions (see refreshToken.model.ts / refreshToken.service.ts)
 * so they can be individually revoked, rotated, and reuse-detected — a bare
 * signed JWT refresh token can't be revoked without a denylist, which is
 * exactly the statefulness a session record gives us for free.
 *
 * The payload carries only what authorization needs — never password data,
 * never business data beyond the tenant/role scoping already implied by
 * the user's account.
 */
export interface AccessTokenPayload {
  sub: string; // userId
  tenantId: string | null;
  role: UserRole;
  type: 'access';
}

export function signAccessToken(payload: Omit<AccessTokenPayload, 'type'>): string {
  return jwt.sign({ ...payload, type: 'access' }, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN,
  } as SignOptions);
}

/**
 * Verifies signature + expiry AND that this token was issued as an access
 * token — without the `type` check, a leaked/misused refresh-shaped token
 * could otherwise be replayed wherever an access token is expected (they'd
 * fail here anyway since refresh tokens aren't JWTs at all, but the check
 * stays as explicit, cheap defense against any future token format change).
 */
export function verifyAccessToken(token: string): AccessTokenPayload {
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
  if (payload.type !== 'access') {
    throw new Error('Token is not an access token');
  }
  return payload;
}

export function toIdString(id: Types.ObjectId | string | null): string | null {
  if (id === null) return null;
  return typeof id === 'string' ? id : id.toString();
}
