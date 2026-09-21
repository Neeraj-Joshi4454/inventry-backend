import type { Types } from 'mongoose';
import { ExpenseCategory } from '../../models/expenseCategory.model';
import { AuditAction } from '../../constants/auditActions';
import { BadRequestError, ConflictError, NotFoundError } from '../../utils/errors';
import { recordAuditLog } from '../auditLogs/auditLog.service';
import type { UserRole } from '../../types/enums';
import type {
  CreateExpenseCategoryInput,
  ListExpenseCategoriesQuery,
  SetExpenseCategoryStatusInput,
  UpdateExpenseCategoryInput,
} from './expenseCategory.validators';

export async function listExpenseCategories(
  tenantId: Types.ObjectId,
  query: Partial<ListExpenseCategoriesQuery>
) {
  const filter: Record<string, unknown> = { tenantId };
  if (!query.status || query.status === 'active') {
    filter.isActive = true;
  } else if (query.status === 'inactive') {
    filter.isActive = false;
  }
  // status === 'all' leaves isActive unfiltered.

  return ExpenseCategory.find(filter).sort({ name: 1 });
}

export async function createExpenseCategory(params: {
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  userRole: UserRole;
  input: CreateExpenseCategoryInput;
  ipAddress?: string;
}) {
  const { tenantId, userId, userRole, input, ipAddress } = params;

  const existing = await ExpenseCategory.findOne({ tenantId, name: input.name.trim() });
  if (existing) {
    throw new ConflictError('An expense category with this name already exists.');
  }

  const category = await ExpenseCategory.create({ tenantId, ...input });

  await recordAuditLog({
    tenantId,
    actorId: userId,
    actorRole: userRole,
    action: AuditAction.EXPENSE_CATEGORY_CREATED,
    entityType: 'ExpenseCategory',
    entityId: category._id,
    changes: { after: { name: category.name } },
    ipAddress,
  });

  return category;
}

export async function updateExpenseCategory(params: {
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  userRole: UserRole;
  categoryId: string;
  input: UpdateExpenseCategoryInput;
  ipAddress?: string;
}) {
  const { tenantId, userId, userRole, categoryId, input, ipAddress } = params;

  const category = await ExpenseCategory.findOne({ _id: categoryId, tenantId });
  if (!category) {
    throw new NotFoundError('Expense category not found');
  }
  // Renaming a system category would silently break the "Rent"/"Salary"/...
  // labels the whole tenant already relies on — description is still
  // editable, just not the name.
  if (category.isSystem && input.name && input.name.trim() !== category.name) {
    throw new BadRequestError('System expense categories cannot be renamed');
  }

  Object.assign(category, input);
  await category.save();

  await recordAuditLog({
    tenantId,
    actorId: userId,
    actorRole: userRole,
    action: AuditAction.EXPENSE_CATEGORY_UPDATED,
    entityType: 'ExpenseCategory',
    entityId: category._id,
    changes: { after: input },
    ipAddress,
  });

  return category;
}

/**
 * Deliberately a status flag, never a delete — expenses already reference a
 * category by id (see expense.model.ts), so a category can never be
 * removed out from under them. System categories additionally can't be
 * deactivated at all, per "System/default categories should not be
 * accidentally deleted."
 */
export async function setExpenseCategoryStatus(params: {
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  userRole: UserRole;
  categoryId: string;
  input: SetExpenseCategoryStatusInput;
  ipAddress?: string;
}) {
  const { tenantId, userId, userRole, categoryId, input, ipAddress } = params;

  const category = await ExpenseCategory.findOne({ _id: categoryId, tenantId });
  if (!category) {
    throw new NotFoundError('Expense category not found');
  }
  if (category.isSystem && !input.isActive) {
    throw new BadRequestError('System expense categories cannot be deactivated');
  }

  category.isActive = input.isActive;
  await category.save();

  await recordAuditLog({
    tenantId,
    actorId: userId,
    actorRole: userRole,
    action: AuditAction.EXPENSE_CATEGORY_STATUS_CHANGED,
    entityType: 'ExpenseCategory',
    entityId: category._id,
    changes: { after: { isActive: input.isActive } },
    ipAddress,
  });

  return category;
}
