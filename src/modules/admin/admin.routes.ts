import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/role.middleware';
import { validate } from '../../middleware/validation.middleware';
import { UserRole } from '../../types/enums';
import {
  adminReportQuerySchema,
  listAdminDocumentsQuerySchema,
  listAdminInventoryQuerySchema,
  listAdminProductsQuerySchema,
  tenantIdParamSchema,
} from './admin.validators';
import {
  getOverviewHandler,
  getReportHandler,
  getTenantStatsHandler,
  listInventoryHandler,
  listProductsHandler,
  listPurchasesHandler,
  listSalesHandler,
} from './admin.controller';

const router = Router();

// Platform-wide, read-only views — SUPER_ADMIN only. Business users keep
// using their own tenant-scoped routers; nothing here accepts writes.
router.use(authenticate, requireRole(UserRole.SUPER_ADMIN));

router.get('/overview', getOverviewHandler);
router.get('/reports', validate({ query: adminReportQuerySchema }), getReportHandler);
router.get(
  '/tenants/:tenantId/stats',
  validate({ params: tenantIdParamSchema }),
  getTenantStatsHandler
);
router.get('/products', validate({ query: listAdminProductsQuerySchema }), listProductsHandler);
router.get('/inventory', validate({ query: listAdminInventoryQuerySchema }), listInventoryHandler);
router.get('/sales', validate({ query: listAdminDocumentsQuerySchema }), listSalesHandler);
router.get('/purchases', validate({ query: listAdminDocumentsQuerySchema }), listPurchasesHandler);

export default router;
