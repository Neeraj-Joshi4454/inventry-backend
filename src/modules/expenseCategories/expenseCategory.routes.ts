import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/role.middleware';
import { requireTenantContext, stripClientTenantId } from '../../middleware/tenant.middleware';
import { validate } from '../../middleware/validation.middleware';
import { UserRole } from '../../types/enums';
import {
  createExpenseCategorySchema,
  expenseCategoryIdParamSchema,
  listExpenseCategoriesQuerySchema,
  setExpenseCategoryStatusSchema,
  updateExpenseCategorySchema,
} from './expenseCategory.validators';
import {
  createExpenseCategoryHandler,
  listExpenseCategoriesHandler,
  setExpenseCategoryStatusHandler,
  updateExpenseCategoryHandler,
} from './expenseCategory.controller';

const router = Router();

router.use(authenticate, requireTenantContext, stripClientTenantId);

// Expenses are an Owner/Manager/Accountant finance concern — the same read
// role set reports.ts uses, with Accountant excluded from writes (view-only
// per DEFAULT_ROLES's own description of that role).
const WRITE_ROLES = [UserRole.OWNER, UserRole.MANAGER] as const;
const READ_ROLES = [...WRITE_ROLES, UserRole.ACCOUNTANT] as const;

router.get(
  '/',
  requireRole(...READ_ROLES),
  validate({ query: listExpenseCategoriesQuerySchema }),
  listExpenseCategoriesHandler
);

router.post(
  '/',
  requireRole(...WRITE_ROLES),
  validate({ body: createExpenseCategorySchema }),
  createExpenseCategoryHandler
);

router.patch(
  '/:id',
  requireRole(...WRITE_ROLES),
  validate({ params: expenseCategoryIdParamSchema, body: updateExpenseCategorySchema }),
  updateExpenseCategoryHandler
);

router.patch(
  '/:id/status',
  requireRole(...WRITE_ROLES),
  validate({ params: expenseCategoryIdParamSchema, body: setExpenseCategoryStatusSchema }),
  setExpenseCategoryStatusHandler
);

export default router;
