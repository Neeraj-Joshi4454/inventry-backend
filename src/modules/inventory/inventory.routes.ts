import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/role.middleware';
import { requireTenantContext, stripClientTenantId } from '../../middleware/tenant.middleware';
import { validate } from '../../middleware/validation.middleware';
import { UserRole } from '../../types/enums';
import {
  listInventoryQuerySchema,
  listTransactionsQuerySchema,
  openingStockSchema,
  productIdParamSchema,
} from './inventory.validators';
import { stockAdjustmentSchema } from './stockAdjustment.validators';
import {
  createOpeningStockHandler,
  createStockAdjustmentHandler,
  getInventoryHandler,
  listInventoryHandler,
  listInventoryTransactionsHandler,
} from './inventory.controller';

const router = Router();

router.use(authenticate, requireTenantContext, stripClientTenantId);

// Everyone who can see the sales/purchase screens also needs to see stock
// levels while using them — reads are open to every business role.
const READ_ROLES = [
  UserRole.OWNER,
  UserRole.MANAGER,
  UserRole.STORE_KEEPER,
  UserRole.SALES_PERSON,
  UserRole.ACCOUNTANT,
] as const;

router.post(
  '/opening-stock',
  requireRole(UserRole.OWNER, UserRole.MANAGER, UserRole.STORE_KEEPER),
  validate({ body: openingStockSchema }),
  createOpeningStockHandler
);

router.post(
  '/adjustments',
  requireRole(UserRole.OWNER, UserRole.MANAGER, UserRole.STORE_KEEPER),
  validate({ body: stockAdjustmentSchema }),
  createStockAdjustmentHandler
);

router.get(
  '/',
  requireRole(...READ_ROLES),
  validate({ query: listInventoryQuerySchema }),
  listInventoryHandler
);

router.get(
  '/:productId',
  requireRole(...READ_ROLES),
  validate({ params: productIdParamSchema }),
  getInventoryHandler
);

router.get(
  '/:productId/transactions',
  requireRole(...READ_ROLES),
  validate({ params: productIdParamSchema, query: listTransactionsQuerySchema }),
  listInventoryTransactionsHandler
);

export default router;
