import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/role.middleware';
import { requireTenantContext, stripClientTenantId } from '../../middleware/tenant.middleware';
import { validate } from '../../middleware/validation.middleware';
import { UserRole } from '../../types/enums';
import {
  dashboardSummaryQuerySchema,
  expenseReportQuerySchema,
  inventoryLedgerReportQuerySchema,
  outstandingCustomersReportQuerySchema,
  profitReportQuerySchema,
  purchaseReportQuerySchema,
  salesReportQuerySchema,
  stockReportQuerySchema,
} from './report.validators';
import {
  getDashboardSummaryHandler,
  getExpenseReportHandler,
  getInventoryLedgerReportHandler,
  getOutstandingCustomersReportHandler,
  getProfitSummaryHandler,
  getPurchaseReportHandler,
  getSalesReportHandler,
  getStockReportHandler,
} from './report.controller';

const router = Router();

router.use(authenticate, requireTenantContext, stripClientTenantId);

// Reports are a leadership/finance function — the same read role set
// DEFAULT_ROLES already describes for Accountant ("views sales, purchases
// and financial reports; read-only on inventory") plus Owner/Manager.
const REPORT_ROLES = [UserRole.OWNER, UserRole.MANAGER, UserRole.ACCOUNTANT] as const;

router.get(
  '/dashboard',
  requireRole(...REPORT_ROLES),
  validate({ query: dashboardSummaryQuerySchema }),
  getDashboardSummaryHandler
);

router.get(
  '/sales',
  requireRole(...REPORT_ROLES),
  validate({ query: salesReportQuerySchema }),
  getSalesReportHandler
);

router.get(
  '/purchases',
  requireRole(...REPORT_ROLES),
  validate({ query: purchaseReportQuerySchema }),
  getPurchaseReportHandler
);

router.get(
  '/stock',
  requireRole(...REPORT_ROLES),
  validate({ query: stockReportQuerySchema }),
  getStockReportHandler
);

router.get(
  '/inventory-ledger',
  requireRole(...REPORT_ROLES),
  validate({ query: inventoryLedgerReportQuerySchema }),
  getInventoryLedgerReportHandler
);

router.get(
  '/profit',
  requireRole(...REPORT_ROLES),
  validate({ query: profitReportQuerySchema }),
  getProfitSummaryHandler
);

router.get(
  '/outstanding-customers',
  requireRole(...REPORT_ROLES),
  validate({ query: outstandingCustomersReportQuerySchema }),
  getOutstandingCustomersReportHandler
);

router.get(
  '/expenses',
  requireRole(...REPORT_ROLES),
  validate({ query: expenseReportQuerySchema }),
  getExpenseReportHandler
);

export default router;
