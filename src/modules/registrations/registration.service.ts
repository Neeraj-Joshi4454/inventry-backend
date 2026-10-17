import type { Types } from 'mongoose';
import { RegistrationRequest } from '../../models/registrationRequest.model';
import { Tenant } from '../../models/tenant.model';
import { User } from '../../models/user.model';
import { AuditAction } from '../../constants/auditActions';
import { RegistrationStatus, UserRole } from '../../types/enums';
import { BadRequestError, ConflictError, NotFoundError } from '../../utils/errors';
import { hashPassword, verifyPassword } from '../../utils/password';
import { buildPaginationMeta, type PaginationParams } from '../../utils/pagination';
import { runInTransaction } from '../../utils/withTransaction';
import { recordAuditLog } from '../auditLogs/auditLog.service';
import { createTenantWithOwnerInSession } from '../tenants/tenant.service';
import type { CreateRegistrationInput, ListRegistrationsQuery } from './registration.validators';

interface Reviewer {
  superAdminId: Types.ObjectId;
  ipAddress?: string;
}

/** Public: a business asks to join. Nothing is created until approval. */
export async function submitRegistration(input: CreateRegistrationInput, ipAddress?: string) {
  const [existingUser, existingTenant, pending] = await Promise.all([
    User.exists({ mobileNumber: input.mobileNumber }),
    Tenant.exists({ mobileNumber: input.mobileNumber }),
    RegistrationRequest.exists({
      mobileNumber: input.mobileNumber,
      status: RegistrationStatus.PENDING,
    }),
  ]);
  if (existingUser || existingTenant) {
    throw new ConflictError('This mobile number is already registered. Please sign in instead.');
  }
  if (pending) {
    throw new ConflictError(
      'A registration for this mobile number is already waiting for approval.'
    );
  }

  const request = await RegistrationRequest.create({
    businessName: input.businessName,
    ownerName: input.ownerName,
    mobileNumber: input.mobileNumber,
    email: input.email,
    passwordHash: await hashPassword(input.password),
    ipAddress,
  });

  return { _id: request._id, status: request.status, createdAt: request.createdAt };
}

export async function listRegistrations(
  query: Partial<ListRegistrationsQuery>,
  pagination: PaginationParams
) {
  const filter = query.status ? { status: query.status } : {};
  const [items, total] = await Promise.all([
    RegistrationRequest.find(filter)
      .sort({ createdAt: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .populate('reviewedBy', 'name'),
    RegistrationRequest.countDocuments(filter),
  ]);
  return { items, meta: buildPaginationMeta(total, pagination.page, pagination.limit) };
}

export function countPendingRegistrations() {
  return RegistrationRequest.countDocuments({ status: RegistrationStatus.PENDING });
}

/**
 * Creates the business and its owner exactly as the admin panel's "New
 * Business" does, with the applicant's own password (so no forced change
 * on first login), and marks the request approved — all in one
 * transaction.
 */
export async function approveRegistration(id: string, reviewer: Reviewer) {
  return runInTransaction(async (session) => {
    const request = await RegistrationRequest.findById(id).select('+passwordHash').session(session);
    if (!request) throw new NotFoundError('Registration request not found');
    if (request.status !== RegistrationStatus.PENDING) {
      throw new BadRequestError(`This request has already been ${request.status.toLowerCase()}`);
    }

    const { tenant } = await createTenantWithOwnerInSession(session, reviewer, {
      businessName: request.businessName,
      ownerName: request.ownerName,
      businessMobileNumber: request.mobileNumber,
      email: request.email ?? undefined,
      adminUser: {
        name: request.ownerName,
        mobileNumber: request.mobileNumber,
        passwordHash: request.passwordHash,
        mustChangePassword: false,
      },
    });

    request.status = RegistrationStatus.APPROVED;
    request.reviewedBy = reviewer.superAdminId;
    request.reviewedAt = new Date();
    request.tenantId = tenant._id;
    await request.save({ session });

    await recordAuditLog({
      tenantId: tenant._id as Types.ObjectId,
      actorId: reviewer.superAdminId,
      actorRole: UserRole.SUPER_ADMIN,
      action: AuditAction.REGISTRATION_APPROVED,
      entityType: 'RegistrationRequest',
      entityId: request._id,
      changes: { after: { businessName: request.businessName, tenantId: tenant._id } },
      ipAddress: reviewer.ipAddress,
      session,
    });

    // Re-read without the password hash (it's select: false by default).
    const approved = await RegistrationRequest.findById(request._id).session(session);
    return { request: approved, tenant };
  });
}

export async function rejectRegistration(id: string, reviewer: Reviewer, reason?: string) {
  const request = await RegistrationRequest.findOneAndUpdate(
    { _id: id, status: RegistrationStatus.PENDING },
    {
      status: RegistrationStatus.REJECTED,
      rejectionReason: reason || undefined,
      reviewedBy: reviewer.superAdminId,
      reviewedAt: new Date(),
    },
    { new: true }
  );
  if (!request) {
    const exists = await RegistrationRequest.exists({ _id: id });
    if (!exists) throw new NotFoundError('Registration request not found');
    throw new BadRequestError('This request has already been reviewed');
  }

  await recordAuditLog({
    tenantId: null,
    actorId: reviewer.superAdminId,
    actorRole: UserRole.SUPER_ADMIN,
    action: AuditAction.REGISTRATION_REJECTED,
    entityType: 'RegistrationRequest',
    entityId: request._id,
    changes: { after: { businessName: request.businessName, reason: request.rejectionReason } },
    ipAddress: reviewer.ipAddress,
  });

  return request;
}

/**
 * For login: when a mobile number has no account yet, tell the applicant
 * where their registration stands — but only once they've proven it's
 * theirs with the password they registered with, so this never reveals
 * anything about someone else's number. Returns null when there's nothing
 * to say (the caller then gives its usual generic error).
 */
export async function registrationStatusMessage(mobileNumber: string, password: string) {
  const request = await RegistrationRequest.findOne({
    mobileNumber,
    status: { $in: [RegistrationStatus.PENDING, RegistrationStatus.REJECTED] },
  })
    .sort({ createdAt: -1 })
    .select('+passwordHash');
  if (!request || !(await verifyPassword(request.passwordHash, password))) return null;

  if (request.status === RegistrationStatus.PENDING) {
    return 'Your registration is waiting for approval. You can sign in once it is approved.';
  }
  return request.rejectionReason
    ? `Your registration was not approved: ${request.rejectionReason}`
    : 'Your registration was not approved. Please contact support.';
}
