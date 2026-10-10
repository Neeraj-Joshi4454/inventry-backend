import type { Types } from 'mongoose';
import { Category } from '../../models/category.model';
import { Product } from '../../models/product.model';
import { AuditAction } from '../../constants/auditActions';
import { ConflictError, NotFoundError } from '../../utils/errors';
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

/**
 * Hard delete, so the name can be reused later. Refused while any product
 * (active or not) still points at this category — reassign those first.
 */
export async function deleteCategory(params: {
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  userRole: UserRole;
  categoryId: string;
  ipAddress?: string;
}) {
  const { tenantId, userId, userRole, categoryId, ipAddress } = params;

  const category = await Category.findOne({ _id: categoryId, tenantId });
  if (!category) {
    throw new NotFoundError('Category not found');
  }

  const productCount = await Product.countDocuments({ tenantId, categoryId: category._id });
  if (productCount > 0) {
    throw new ConflictError(
      `Cannot delete "${category.name}" — ${productCount} product${productCount === 1 ? ' uses' : 's use'} this category.`
    );
  }

  await category.deleteOne();

  await recordAuditLog({
    tenantId,
    actorId: userId,
    actorRole: userRole,
    action: AuditAction.CATEGORY_DELETED,
    entityType: 'Category',
    entityId: category._id,
    changes: { before: { name: category.name } },
    ipAddress,
  });
}
