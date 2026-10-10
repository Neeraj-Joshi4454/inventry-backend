import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/role.middleware';
import { requireTenantContext, stripClientTenantId } from '../../middleware/tenant.middleware';
import { validate } from '../../middleware/validation.middleware';
import { UserRole } from '../../types/enums';
import {
  createSupplierSchema,
  listSuppliersQuerySchema,
  setSupplierStatusSchema,
  supplierIdParamSchema,
  supplierPurchaseHistoryQuerySchema,
  updateSupplierSchema,
} from './supplier.validators';
import {
  createSupplierHandler,
  getSupplierHandler,
  getSupplierPurchaseHistoryHandler,
  listSuppliersHandler,
  setSupplierStatusHandler,
  updateSupplierHandler,
} from './supplier.controller';

const router = Router();

router.use(authenticate, requireTenantContext, stripClientTenantId);

// Suppliers are a stock-management function — Sales Person is intentionally
// excluded (mirrors purchase.routes.ts's role split), unlike Customers
// which Sales Person can also write.
const WRITE_ROLES = [UserRole.OWNER, UserRole.MANAGER, UserRole.STORE_KEEPER] as const;
const READ_ROLES = [...WRITE_ROLES, UserRole.ACCOUNTANT] as const;

router.post(
  '/',
  requireRole(...WRITE_ROLES),
  validate({ body: createSupplierSchema }),
  createSupplierHandler
);
router.get(
  '/',
  requireRole(...READ_ROLES),
  validate({ query: listSuppliersQuerySchema }),
  listSuppliersHandler
);
router.get(
  '/:id',
  requireRole(...READ_ROLES),
  validate({ params: supplierIdParamSchema }),
  getSupplierHandler
);
router.patch(
  '/:id',
  requireRole(...WRITE_ROLES),
  validate({ params: supplierIdParamSchema, body: updateSupplierSchema }),
  updateSupplierHandler
);
router.patch(
  '/:id/status',
  requireRole(UserRole.OWNER, UserRole.MANAGER),
  validate({ params: supplierIdParamSchema, body: setSupplierStatusSchema }),
  setSupplierStatusHandler
);
router.get(
  '/:id/purchases',
  requireRole(...READ_ROLES),
  validate({ params: supplierIdParamSchema, query: supplierPurchaseHistoryQuerySchema }),
  getSupplierPurchaseHistoryHandler
);

export default router;
