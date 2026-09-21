import type { ClientSession, Types } from 'mongoose';
import { AuditLog } from '../../models/auditLog.model';
import type { UserRole } from '../../types/enums';
import { logger } from '../../config/logger';
import { buildPaginationMeta, type PaginationParams } from '../../utils/pagination';

export interface RecordAuditLogInput {
  // null only for a platform-level SUPER_ADMIN action not tied to one tenant
  // (e.g. creating the tenant itself — the tenant didn't exist yet at the
  // start of that action). Once a tenant exists, actions affecting it
  // should always carry its id, even when performed by SUPER_ADMIN.
  tenantId: Types.ObjectId | null;
  actorId: Types.ObjectId;
  actorRole: UserRole;
  action: string;
  entityType: string;
  entityId: Types.ObjectId;
  changes?: { before?: unknown; after?: unknown };
  ipAddress?: string;
  session?: ClientSession;
}

/**
 * Writes one audit log entry. Never throws into the caller's request path —
 * a logging failure must not fail the business operation it's describing;
 * it's logged locally instead so the gap is visible to operators.
 *
 * Never pass password/token material in `changes` — this is a system-wide
 * invariant, not something enforced by types, since `changes` is
 * intentionally free-form to fit every entity type.
 */
export async function recordAuditLog(input: RecordAuditLogInput): Promise<void> {
  try {
    await AuditLog.create(
      [
        {
          tenantId: input.tenantId,
          actorId: input.actorId,
          actorRole: input.actorRole,
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId,
          changes: input.changes,
          ipAddress: input.ipAddress,
        },
      ],
      input.session ? { session: input.session } : {}
    );
  } catch (err) {
    logger.error(
      { err, action: input.action, entityType: input.entityType },
      'Failed to write audit log'
    );
  }
}

export async function listAuditLogs(
  filter: { tenantId?: Types.ObjectId },
  pagination: PaginationParams
) {
  const [logs, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1 }).skip(pagination.skip).limit(pagination.limit),
    AuditLog.countDocuments(filter),
  ]);
  return { logs, meta: buildPaginationMeta(total, pagination.page, pagination.limit) };
}
