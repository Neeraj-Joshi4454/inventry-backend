import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/role.middleware';
import { requireTenantContext, stripClientTenantId } from '../../middleware/tenant.middleware';
import { validate } from '../../middleware/validation.middleware';
import { UserRole } from '../../types/enums';
import {
  createExpenseSchema,
  expenseIdParamSchema,
  listExpensesQuerySchema,
  setExpenseStatusSchema,
  updateExpenseSchema,
} from './expense.validators';
import {
  createExpenseHandler,
  getExpenseHandler,
  getExpenseSummaryHandler,
  listExpensesHandler,
  setExpenseStatusHandler,
  updateExpenseHandler,
} from './expense.controller';

const router = Router();

router.use(authenticate, requireTenantContext, stripClientTenantId);

const WRITE_ROLES = [UserRole.OWNER, UserRole.MANAGER] as const;
const READ_ROLES = [...WRITE_ROLES, UserRole.ACCOUNTANT] as const;

router.post(
  '/',
  requireRole(...WRITE_ROLES),
  validate({ body: createExpenseSchema }),
  createExpenseHandler
);

router.get(
  '/',
  requireRole(...READ_ROLES),
  validate({ query: listExpensesQuerySchema }),
  listExpensesHandler
);

// Must be registered before '/:id' — otherwise Express would match
// "summary" as the :id path parameter.
router.get('/summary', requireRole(...READ_ROLES), getExpenseSummaryHandler);

router.get(
  '/:id',
  requireRole(...READ_ROLES),
  validate({ params: expenseIdParamSchema }),
  getExpenseHandler
);

router.patch(
  '/:id',
  requireRole(...WRITE_ROLES),
  validate({ params: expenseIdParamSchema, body: updateExpenseSchema }),
  updateExpenseHandler
);

router.patch(
  '/:id/status',
  requireRole(...WRITE_ROLES),
  validate({ params: expenseIdParamSchema, body: setExpenseStatusSchema }),
  setExpenseStatusHandler
);

export default router;
