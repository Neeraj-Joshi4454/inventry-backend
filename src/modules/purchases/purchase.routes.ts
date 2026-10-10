import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/role.middleware';
import { requireTenantContext, stripClientTenantId } from '../../middleware/tenant.middleware';
import { validate } from '../../middleware/validation.middleware';
import { UserRole } from '../../types/enums';
import {
  createPurchaseSchema,
  listPurchasesQuerySchema,
  purchaseIdParamSchema,
} from './purchase.validators';
import {
  createPurchaseHandler,
  getPurchaseHandler,
  getPurchaseInvoiceHandler,
  listPurchasesHandler,
} from './purchase.controller';

const router = Router();

router.use(authenticate, requireTenantContext, stripClientTenantId);

// Purchasing is a stock-management function — Sales Person is intentionally
// excluded (mirrors the read/write role split already used for sales).
router.post(
  '/',
  requireRole(UserRole.OWNER, UserRole.MANAGER, UserRole.STORE_KEEPER),
  validate({ body: createPurchaseSchema }),
  createPurchaseHandler
);

router.get(
  '/',
  requireRole(UserRole.OWNER, UserRole.MANAGER, UserRole.STORE_KEEPER, UserRole.ACCOUNTANT),
  validate({ query: listPurchasesQuerySchema }),
  listPurchasesHandler
);

router.get(
  '/:id',
  requireRole(UserRole.OWNER, UserRole.MANAGER, UserRole.STORE_KEEPER, UserRole.ACCOUNTANT),
  validate({ params: purchaseIdParamSchema }),
  getPurchaseHandler
);

router.get(
  '/:id/invoice',
  requireRole(UserRole.OWNER, UserRole.MANAGER, UserRole.STORE_KEEPER, UserRole.ACCOUNTANT),
  validate({ params: purchaseIdParamSchema }),
  getPurchaseInvoiceHandler
);

export default router;
