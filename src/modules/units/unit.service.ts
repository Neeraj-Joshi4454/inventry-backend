import type { Types } from 'mongoose';
import { Unit } from '../../models/unit.model';
import { AuditAction } from '../../constants/auditActions';
import { ConflictError } from '../../utils/errors';
import { recordAuditLog } from '../auditLogs/auditLog.service';
import type { UserRole } from '../../types/enums';
import type { CreateUnitInput } from './unit.validators';

/** See category.service.ts — same reasoning: read-only path plus a fallback create for Add Product. */
export async function listUnits(tenantId: Types.ObjectId) {
  return Unit.find({ tenantId, isActive: true }).sort({ name: 1 });
}

export async function createUnit(params: {
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  userRole: UserRole;
  input: CreateUnitInput;
  ipAddress?: string;
}) {
  const { tenantId, userId, userRole, input, ipAddress } = params;

  const existing = await Unit.findOne({ tenantId, name: input.name.trim() });
  if (existing) {
    throw new ConflictError('A unit with this name already exists.');
  }

  const unit = await Unit.create({ tenantId, ...input });

  await recordAuditLog({
    tenantId,
    actorId: userId,
    actorRole: userRole,
    action: AuditAction.UNIT_CREATED,
    entityType: 'Unit',
    entityId: unit._id,
    changes: { after: { name: unit.name, symbol: unit.symbol } },
    ipAddress,
  });

  return unit;
}
