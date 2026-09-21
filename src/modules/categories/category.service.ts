import type { Types } from 'mongoose';
import { Category } from '../../models/category.model';
import { AuditAction } from '../../constants/auditActions';
import { ConflictError } from '../../utils/errors';
import { recordAuditLog } from '../auditLogs/auditLog.service';
import type { UserRole } from '../../types/enums';
import type { CreateCategoryInput } from './category.validators';

/**
 * Every tenant already gets a default category set on creation (see
 * tenants/tenant.service.ts DEFAULT_CATEGORIES), so listing is the primary
 * path — this create exists as a fallback for the Add Product form, so a
 * user is never blocked from creating a product just because the category
 * they need isn't in the default set.
 */
export async function listCategories(tenantId: Types.ObjectId) {
  return Category.find({ tenantId, isActive: true }).sort({ name: 1 });
}

export async function createCategory(params: {
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  userRole: UserRole;
  input: CreateCategoryInput;
  ipAddress?: string;
}) {
  const { tenantId, userId, userRole, input, ipAddress } = params;

  const existing = await Category.findOne({ tenantId, name: input.name.trim() });
  if (existing) {
    throw new ConflictError('A category with this name already exists.');
  }

  const category = await Category.create({ tenantId, ...input });

  await recordAuditLog({
    tenantId,
    actorId: userId,
    actorRole: userRole,
    action: AuditAction.CATEGORY_CREATED,
    entityType: 'Category',
    entityId: category._id,
    changes: { after: { name: category.name } },
    ipAddress,
  });

  return category;
}
