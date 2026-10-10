import type { Types } from 'mongoose';
import { Unit } from '../../models/unit.model';
import { Product } from '../../models/product.model';
import { AuditAction } from '../../constants/auditActions';
import { ConflictError, NotFoundError } from '../../utils/errors';
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

/**
 * Hard delete, so the name can be reused later. Refused while any product
 * (active or not) still points at this unit — reassign those first.
 */
export async function deleteUnit(params: {
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  userRole: UserRole;
  unitId: string;
  ipAddress?: string;
}) {
  const { tenantId, userId, userRole, unitId, ipAddress } = params;

  const unit = await Unit.findOne({ _id: unitId, tenantId });
  if (!unit) {
    throw new NotFoundError('Unit not found');
  }

  const productCount = await Product.countDocuments({ tenantId, unitId: unit._id });
  if (productCount > 0) {
    throw new ConflictError(
      `Cannot delete "${unit.name}" — ${productCount} product${productCount === 1 ? ' uses' : 's use'} this unit.`
    );
  }

  await unit.deleteOne();

  await recordAuditLog({
    tenantId,
    actorId: userId,
    actorRole: userRole,
    action: AuditAction.UNIT_DELETED,
    entityType: 'Unit',
    entityId: unit._id,
    changes: { before: { name: unit.name } },
    ipAddress,
  });
}
