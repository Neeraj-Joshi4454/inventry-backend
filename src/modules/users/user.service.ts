import { Types } from 'mongoose';
import { User } from '../../models/user.model';
import { Tenant } from '../../models/tenant.model';
import { AccountStatus, type UserRole } from '../../types/enums';
import { AuditAction } from '../../constants/auditActions';
import { ConflictError, NotFoundError } from '../../utils/errors';
import { hashPassword } from '../../utils/password';
import { buildAllowedFilter } from '../../utils/queryFilters';
import { buildPaginationMeta, type PaginationParams } from '../../utils/pagination';
import { recordAuditLog } from '../auditLogs/auditLog.service';
import { revokeAllSessionsForUser } from '../auth/refreshToken.service';
import type { CreateUserInput, ListUsersQuery, UpdateUserInput } from './user.validators';

export interface ActorContext {
  actorId: Types.ObjectId;
  actorRole: UserRole;
  ipAddress?: string;
}

/** Fields ever safe to send to a client — never passwordHash. */
const SAFE_USER_FIELDS =
  'name mobileNumber role status tenantId mustChangePassword lastLoginAt createdAt updatedAt';

export async function createUser(input: CreateUserInput, actor: ActorContext) {
  const tenant = await Tenant.findById(input.tenantId);
  if (!tenant) {
    throw new NotFoundError('Tenant not found');
  }

  const existing = await User.findOne({ mobileNumber: input.mobileNumber });
  if (existing) {
    throw new ConflictError('This mobile number is already registered to an account');
  }

  const passwordHash = await hashPassword(input.password);

  const user = await User.create({
    tenantId: tenant._id,
    name: input.name,
    mobileNumber: input.mobileNumber,
    passwordHash,
    role: input.role,
    status: AccountStatus.ACTIVE,
    mustChangePassword: true,
    createdBy: actor.actorId,
  });

  await recordAuditLog({
    tenantId: tenant._id as Types.ObjectId,
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    action: AuditAction.USER_CREATED,
    entityType: 'User',
    entityId: user._id as Types.ObjectId,
    changes: { after: { name: user.name, role: user.role, mobileNumber: user.mobileNumber } },
    ipAddress: actor.ipAddress,
  });

  return User.findById(user._id).select(SAFE_USER_FIELDS);
}

export async function listUsers(query: ListUsersQuery, pagination: PaginationParams) {
  const filter = buildAllowedFilter<{ tenantId: string; role: string; status: string }>(query, [
    'tenantId',
    'role',
    'status',
  ]);

  const [users, total] = await Promise.all([
    User.find(filter)
      .select(SAFE_USER_FIELDS)
      .sort({ createdAt: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit),
    User.countDocuments(filter),
  ]);

  return { users, meta: buildPaginationMeta(total, pagination.page, pagination.limit) };
}

export async function getUserById(id: string) {
  const user = await User.findById(id).select(SAFE_USER_FIELDS);
  if (!user) {
    throw new NotFoundError('User not found');
  }
  return user;
}

export async function updateUser(id: string, input: UpdateUserInput, actor: ActorContext) {
  const user = await User.findById(id);
  if (!user) {
    throw new NotFoundError('User not found');
  }

  const before = { name: user.name, role: user.role };
  if (input.name !== undefined) user.name = input.name;
  if (input.role !== undefined) user.role = input.role;
  await user.save();

  await recordAuditLog({
    tenantId: user.tenantId as Types.ObjectId | null,
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    action: AuditAction.USER_UPDATED,
    entityType: 'User',
    entityId: user._id as Types.ObjectId,
    changes: { before, after: { name: user.name, role: user.role } },
    ipAddress: actor.ipAddress,
  });

  return User.findById(user._id).select(SAFE_USER_FIELDS);
}

export async function updateUserStatus(id: string, status: AccountStatus, actor: ActorContext) {
  const user = await User.findById(id);
  if (!user) {
    throw new NotFoundError('User not found');
  }

  const before = user.status;
  user.status = status;
  await user.save();

  // A no-longer-ACTIVE user must lose access immediately, not just at their
  // access token's natural expiry.
  if (status !== AccountStatus.ACTIVE) {
    await revokeAllSessionsForUser(user._id as Types.ObjectId);
  }

  await recordAuditLog({
    tenantId: user.tenantId as Types.ObjectId | null,
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    action: AuditAction.USER_STATUS_CHANGED,
    entityType: 'User',
    entityId: user._id as Types.ObjectId,
    changes: { before: { status: before }, after: { status } },
    ipAddress: actor.ipAddress,
  });

  return User.findById(user._id).select(SAFE_USER_FIELDS);
}

/**
 * Super-Admin-driven password reset — the only reset mechanism that exists,
 * since there's no OTP/email flow. The caller supplies the new password
 * directly (the same admin-sets-password pattern used at account creation);
 * the backend never generates or returns it.
 */
export async function resetUserPassword(id: string, newPassword: string, actor: ActorContext) {
  const user = await User.findById(id);
  if (!user) {
    throw new NotFoundError('User not found');
  }

  user.passwordHash = await hashPassword(newPassword);
  user.mustChangePassword = true;
  await user.save();

  await revokeAllSessionsForUser(user._id as Types.ObjectId);

  await recordAuditLog({
    tenantId: user.tenantId as Types.ObjectId | null,
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    action: AuditAction.PASSWORD_RESET,
    entityType: 'User',
    entityId: user._id as Types.ObjectId,
    ipAddress: actor.ipAddress,
  });
}
