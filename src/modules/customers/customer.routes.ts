import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/role.middleware';
import { requireTenantContext, stripClientTenantId } from '../../middleware/tenant.middleware';
import { validate } from '../../middleware/validation.middleware';
import { UserRole } from '../../types/enums';
import {
  createCustomerSchema,
  customerIdParamSchema,
  customerSalesHistoryQuerySchema,
  listCustomersQuerySchema,
  setCustomerStatusSchema,
  updateCustomerSchema,
} from './customer.validators';
import {
  createCustomerHandler,
  getCustomerHandler,
  getCustomerSalesHistoryHandler,
  listCustomersHandler,
  setCustomerStatusHandler,
  updateCustomerHandler,
} from './customer.controller';

const router = Router();

router.use(authenticate, requireTenantContext, stripClientTenantId);

// Anyone who can create a sale needs to be able to add a customer inline
// while doing so — the write role set here matches sale.routes.ts's create
// role set (Sales Person included), unlike suppliers/purchasing which is
// stock-management-only.
const writeRoles = [
  UserRole.OWNER,
  UserRole.MANAGER,
  UserRole.STORE_KEEPER,
  UserRole.SALES_PERSON,
] as const;

router.post(
  '/',
  requireRole(...writeRoles),
  validate({ body: createCustomerSchema }),
  createCustomerHandler
);
router.get('/', validate({ query: listCustomersQuerySchema }), listCustomersHandler);
router.get('/:id', validate({ params: customerIdParamSchema }), getCustomerHandler);
router.patch(
  '/:id',
  requireRole(...writeRoles),
  validate({ params: customerIdParamSchema, body: updateCustomerSchema }),
  updateCustomerHandler
);
router.patch(
  '/:id/status',
  requireRole(UserRole.OWNER, UserRole.MANAGER),
  validate({ params: customerIdParamSchema, body: setCustomerStatusSchema }),
  setCustomerStatusHandler
);
router.get(
  '/:id/sales',
  validate({ params: customerIdParamSchema, query: customerSalesHistoryQuerySchema }),
  getCustomerSalesHistoryHandler
);

export default router;
