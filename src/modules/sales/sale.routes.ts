import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/role.middleware';
import { requireTenantContext, stripClientTenantId } from '../../middleware/tenant.middleware';
import { validate } from '../../middleware/validation.middleware';
import { UserRole } from '../../types/enums';
import { createSaleSchema, listSalesQuerySchema, saleIdParamSchema } from './sale.validators';
import {
  createSaleHandler,
  getSaleHandler,
  getSaleInvoiceHandler,
  listSalesHandler,
} from './sale.controller';

const router = Router();

// SUPER_ADMIN is intentionally excluded from this router: it operates
// purely on req.user.tenantId, which is null for SUPER_ADMIN. Cross-tenant
// visibility for Super Admin is a separate, explicit capability (a future
// /tenants/:tenantId/sales-style endpoint), not an implicit side effect of
// reusing this tenant-scoped router.
router.use(authenticate, requireTenantContext, stripClientTenantId);

router.post(
  '/',
  requireRole(UserRole.OWNER, UserRole.MANAGER, UserRole.STORE_KEEPER, UserRole.SALES_PERSON),
  validate({ body: createSaleSchema }),
  createSaleHandler
);

router.get(
  '/',
  requireRole(
    UserRole.OWNER,
    UserRole.MANAGER,
    UserRole.STORE_KEEPER,
    UserRole.SALES_PERSON,
    UserRole.ACCOUNTANT
  ),
  validate({ query: listSalesQuerySchema }),
  listSalesHandler
);

router.get(
  '/:id',
  requireRole(
    UserRole.OWNER,
    UserRole.MANAGER,
    UserRole.STORE_KEEPER,
    UserRole.SALES_PERSON,
    UserRole.ACCOUNTANT
  ),
  validate({ params: saleIdParamSchema }),
  getSaleHandler
);

router.get(
  '/:id/invoice',
  requireRole(
    UserRole.OWNER,
    UserRole.MANAGER,
    UserRole.STORE_KEEPER,
    UserRole.SALES_PERSON,
    UserRole.ACCOUNTANT
  ),
  validate({ params: saleIdParamSchema }),
  getSaleInvoiceHandler
);

export default router;
