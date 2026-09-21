import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/role.middleware';
import { requireTenantContext, stripClientTenantId } from '../../middleware/tenant.middleware';
import { validate } from '../../middleware/validation.middleware';
import { UserRole } from '../../types/enums';
import { listSalesQuerySchema } from '../sales/sale.validators';
import { listPurchasesQuerySchema } from '../purchases/purchase.validators';
import { listInventoryQuerySchema } from '../inventory/inventory.validators';
import { listCustomersQuerySchema } from '../customers/customer.validators';
import { listSuppliersQuerySchema } from '../suppliers/supplier.validators';
import {
  exportCustomersCsvHandler,
  exportInventoryCsvHandler,
  exportPurchasesCsvHandler,
  exportSalesCsvHandler,
  exportSuppliersCsvHandler,
} from './export.controller';

const router = Router();

router.use(authenticate, requireTenantContext, stripClientTenantId);

// Same read role set each source module already uses for its own list
// endpoint — an export is just that same data in a different envelope.
const REPORT_ROLES = [UserRole.OWNER, UserRole.MANAGER, UserRole.ACCOUNTANT] as const;

router.get(
  '/sales',
  requireRole(...REPORT_ROLES),
  validate({ query: listSalesQuerySchema }),
  exportSalesCsvHandler
);
router.get(
  '/purchases',
  requireRole(...REPORT_ROLES),
  validate({ query: listPurchasesQuerySchema }),
  exportPurchasesCsvHandler
);
router.get(
  '/inventory',
  requireRole(...REPORT_ROLES),
  validate({ query: listInventoryQuerySchema }),
  exportInventoryCsvHandler
);
router.get(
  '/customers',
  requireRole(...REPORT_ROLES),
  validate({ query: listCustomersQuerySchema }),
  exportCustomersCsvHandler
);
router.get(
  '/suppliers',
  requireRole(...REPORT_ROLES),
  validate({ query: listSuppliersQuerySchema }),
  exportSuppliersCsvHandler
);

export default router;
