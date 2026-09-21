import type { ClientSession, Types } from 'mongoose';
import { RefreshToken, type RefreshTokenDocument } from '../../models/refreshToken.model';
import { env } from '../../config/env';
import { durationMs } from '../../utils/durationMs';
import {
  buildRefreshToken,
  generateRefreshSecret,
  hashRefreshSecret,
  parseRefreshToken,
  safeCompareHash,
} from '../../utils/refreshTokenCrypto';
import { UnauthorizedError } from '../../utils/errors';
import { logger } from '../../config/logger';

export interface SessionMeta {
  userAgent?: string;
  ipAddress?: string;
}

/** Creates a brand-new refresh session (used at login). */
export async function createSession(
  userId: Types.ObjectId,
  tenantId: Types.ObjectId | null,
  meta: SessionMeta = {},
  mongoSession?: ClientSession
): Promise<{ refreshToken: string; sessionDoc: RefreshTokenDocument }> {
  const secret = generateRefreshSecret();
  const expiresAt = new Date(Date.now() + durationMs(env.JWT_REFRESH_EXPIRES_IN));

  const [doc] = await RefreshToken.create(
    [
      {
        userId,
        tenantId,
        tokenHash: hashRefreshSecret(secret),
        userAgent: meta.userAgent,
        ipAddress: meta.ipAddress,
        expiresAt,
      },
    ],
    mongoSession ? { session: mongoSession } : {}
  );

  return { refreshToken: buildRefreshToken(doc._id.toString(), secret), sessionDoc: doc };
}

/**
 * Validates a client-presented refresh token WITHOUT rotating it — used by
 * both /auth/refresh (which then rotates) and /auth/logout (which then
 * revokes just this one session).
 *
 * Reuse detection: if the session this token points to is already revoked,
 * that means either (a) a double-submit race, or (b) a token that was
 * already rotated is being replayed — e.g. an attacker captured an old
 * refresh token and the legitimate client already rotated past it. Standard
 * mitigation: treat this as a likely compromise and revoke every active
 * session for the user, forcing a fresh login everywhere.
 */
export async function validateRefreshToken(rawToken: string): Promise<RefreshTokenDocument> {
  const parsed = parseRefreshToken(rawToken);
  if (!parsed) {
    throw new UnauthorizedError('Invalid or expired refresh token');
  }

  const session = await RefreshToken.findById(parsed.sessionId);
  if (!session) {
    throw new UnauthorizedError('Invalid or expired refresh token');
  }

  if (session.revokedAt) {
    logger.warn(
      { userId: session.userId, sessionId: session._id },
      'Reuse of a revoked refresh token detected — revoking all sessions for this user'
    );
    await revokeAllSessionsForUser(session.userId as Types.ObjectId);
    throw new UnauthorizedError('Refresh token has been revoked');
  }

  if (session.expiresAt.getTime() < Date.now()) {
    throw new UnauthorizedError('Invalid or expired refresh token');
  }

  if (!safeCompareHash(hashRefreshSecret(parsed.secret), session.tokenHash)) {
    throw new UnauthorizedError('Invalid or expired refresh token');
  }

  return session;
}

/** Rotates a validated session: revokes it and issues a new one in its place. */
export async function rotateSession(
  currentSession: RefreshTokenDocument,
  meta: SessionMeta = {}
): Promise<{ refreshToken: string; sessionDoc: RefreshTokenDocument }> {
  const { refreshToken, sessionDoc } = await createSession(
    currentSession.userId as Types.ObjectId,
    currentSession.tenantId as Types.ObjectId | null,
    meta
  );

  await RefreshToken.updateOne(
    { _id: currentSession._id },
    { revokedAt: new Date(), replacedBySessionId: sessionDoc._id }
  );

  return { refreshToken, sessionDoc };
}

export async function touchSession(sessionId: Types.ObjectId): Promise<void> {
  await RefreshToken.updateOne({ _id: sessionId }, { lastUsedAt: new Date() });
}

export async function revokeSessionById(sessionId: string | Types.ObjectId): Promise<void> {
  await RefreshToken.updateOne({ _id: sessionId, revokedAt: null }, { revokedAt: new Date() });
}

/** Revokes every active session for a user — used on suspend, password change/reset, and reuse detection. */
export async function revokeAllSessionsForUser(
  userId: Types.ObjectId,
  mongoSession?: ClientSession
): Promise<void> {
  await RefreshToken.updateMany(
    { userId, revokedAt: null },
    { revokedAt: new Date() },
    mongoSession ? { session: mongoSession } : {}
  );
}
