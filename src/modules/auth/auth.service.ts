import { Types } from 'mongoose';
import { User } from '../../models/user.model';
import { Tenant } from '../../models/tenant.model';
import { AccountStatus } from '../../types/enums';
import { AuditAction } from '../../constants/auditActions';
import { BadRequestError, ForbiddenError, UnauthorizedError } from '../../utils/errors';
import { hashPassword, verifyPassword } from '../../utils/password';
import { signAccessToken, toIdString } from '../../utils/jwt';
import { recordAuditLog } from '../auditLogs/auditLog.service';
import * as sessionService from './refreshToken.service';
import type { SessionMeta } from './refreshToken.service';
import { registrationStatusMessage } from '../registrations/registration.service';

const GENERIC_LOGIN_ERROR = 'Invalid mobile number or password';

async function issueAccessToken(user: {
  _id: unknown;
  tenantId?: unknown;
  role: Parameters<typeof signAccessToken>[0]['role'];
}) {
  return signAccessToken({
    sub: toIdString(user._id as never)!,
    tenantId: toIdString((user.tenantId ?? null) as never),
    role: user.role,
  });
}

/**
 * Login never reveals WHY it failed beyond the generic message for
 * credential-related failures (nonexistent mobile number vs. wrong
 * password look identical to the caller) — this is deliberate user-
 * enumeration prevention. Account status (inactive/suspended) is surfaced
 * distinctly because it's an operational fact the business owner already
 * knows about their own account/team, not something a stranger could use
 * to enumerate valid mobile numbers at scale the way a bare "wrong
 * password" vs "no such user" split would.
 */
export async function login(mobileNumber: string, password: string, meta: SessionMeta = {}) {
  const user = await User.findOne({ mobileNumber }).select('+passwordHash');

  if (!user) {
    // No account yet — maybe a self-service registration still under
    // review (or rejected); say so instead of "invalid credentials".
    const registrationMessage = await registrationStatusMessage(mobileNumber, password);
    if (registrationMessage) throw new ForbiddenError(registrationMessage);
  }

  if (!user || !(await verifyPassword(user.passwordHash, password))) {
    if (user) {
      await recordAuditLog({
        tenantId: user.tenantId as Types.ObjectId | null,
        actorId: user._id as Types.ObjectId,
        actorRole: user.role,
        action: AuditAction.LOGIN_FAILED,
        entityType: 'User',
        entityId: user._id as Types.ObjectId,
        ipAddress: meta.ipAddress,
      });
    }
    throw new UnauthorizedError(GENERIC_LOGIN_ERROR);
  }

  if (user.status !== AccountStatus.ACTIVE) {
    throw new ForbiddenError('Your account has been deactivated or suspended');
  }

  if (user.tenantId) {
    const tenant = await Tenant.findById(user.tenantId).select('status');
    if (!tenant || tenant.status !== AccountStatus.ACTIVE) {
      throw new ForbiddenError('Your business account has been deactivated or suspended');
    }
  }

  user.lastLoginAt = new Date();
  await user.save();

  const accessToken = await issueAccessToken(user);
  const { refreshToken } = await sessionService.createSession(
    user._id as Types.ObjectId,
    user.tenantId as Types.ObjectId | null,
    meta
  );

  await recordAuditLog({
    tenantId: user.tenantId as Types.ObjectId | null,
    actorId: user._id as Types.ObjectId,
    actorRole: user.role,
    action: AuditAction.LOGIN_SUCCESS,
    entityType: 'User',
    entityId: user._id as Types.ObjectId,
    ipAddress: meta.ipAddress,
  });

  return {
    accessToken,
    refreshToken,
    user: {
      id: user._id,
      name: user.name,
      role: user.role,
      tenantId: user.tenantId,
      mustChangePassword: user.mustChangePassword,
    },
  };
}

export async function refresh(refreshToken: string, meta: SessionMeta = {}) {
  const currentSession = await sessionService.validateRefreshToken(refreshToken);

  const user = await User.findById(currentSession.userId);
  if (!user || user.status !== AccountStatus.ACTIVE) {
    await sessionService.revokeSessionById(currentSession._id as Types.ObjectId);
    throw new UnauthorizedError('Account is not active');
  }

  if (user.tenantId) {
    const tenant = await Tenant.findById(user.tenantId).select('status');
    if (!tenant || tenant.status !== AccountStatus.ACTIVE) {
      await sessionService.revokeSessionById(currentSession._id as Types.ObjectId);
      throw new UnauthorizedError('Business account is not active');
    }
  }

  const accessToken = await issueAccessToken(user);
  const { refreshToken: newRefreshToken } = await sessionService.rotateSession(
    currentSession,
    meta
  );

  return { accessToken, refreshToken: newRefreshToken };
}

export async function logout(refreshToken: string) {
  // Validate first so logout can't be used to probe/revoke an arbitrary
  // sessionId without knowing its secret half.
  const session = await sessionService.validateRefreshToken(refreshToken);
  await sessionService.revokeSessionById(session._id as Types.ObjectId);

  const actor = await User.findById(session.userId).select('role');
  if (!actor) return; // session outlived its user (shouldn't happen — users are never hard-deleted)

  await recordAuditLog({
    tenantId: session.tenantId as Types.ObjectId | null,
    actorId: session.userId as Types.ObjectId,
    actorRole: actor.role,
    action: AuditAction.LOGOUT,
    entityType: 'User',
    entityId: session.userId as Types.ObjectId,
  });
}

export async function getMe(userId: Types.ObjectId) {
  const user = await User.findById(userId).populate('tenantId', 'businessName');
  if (!user) {
    throw new UnauthorizedError();
  }

  const tenant = user.tenantId as unknown as { _id: Types.ObjectId; businessName: string } | null;

  return {
    id: user._id,
    name: user.name,
    mobileNumber: user.mobileNumber,
    role: user.role,
    tenant: tenant ? { id: tenant._id, name: tenant.businessName } : null,
  };
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string) {
  const user = await User.findById(userId).select('+passwordHash');
  if (!user) {
    throw new UnauthorizedError();
  }

  const validPassword = await verifyPassword(user.passwordHash, currentPassword);
  if (!validPassword) {
    throw new BadRequestError('Current password is incorrect');
  }

  user.passwordHash = await hashPassword(newPassword);
  user.mustChangePassword = false;
  await user.save();

  // Force re-login everywhere else — a changed password should invalidate
  // any session established with the old one.
  await sessionService.revokeAllSessionsForUser(user._id as Types.ObjectId);

  await recordAuditLog({
    tenantId: user.tenantId as Types.ObjectId | null,
    actorId: user._id as Types.ObjectId,
    actorRole: user.role,
    action: AuditAction.PASSWORD_CHANGED,
    entityType: 'User',
    entityId: user._id as Types.ObjectId,
  });
}
