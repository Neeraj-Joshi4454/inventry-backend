import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/role.middleware';
import { requireTenantContext, stripClientTenantId } from '../../middleware/tenant.middleware';
import { validate } from '../../middleware/validation.middleware';
import { UserRole } from '../../types/enums';
import {
  listSupplierPaymentsQuerySchema,
  recordSupplierPaymentSchema,
  supplierPaymentIdParamSchema,
} from './supplierPayment.validators';
import {
  getSupplierPaymentHandler,
  listSupplierPaymentsHandler,
  recordSupplierPaymentHandler,
} from './supplierPayment.controller';

const router = Router();

router.use(authenticate, requireTenantContext, stripClientTenantId);

// Matches purchase.routes.ts's role sets — whoever can create/view a
// purchase can record/view payments against it.
const WRITE_ROLES = [UserRole.OWNER, UserRole.MANAGER, UserRole.STORE_KEEPER] as const;
const READ_ROLES = [...WRITE_ROLES, UserRole.ACCOUNTANT] as const;

router.post(
  '/',
  requireRole(...WRITE_ROLES),
  validate({ body: recordSupplierPaymentSchema }),
  recordSupplierPaymentHandler
);

router.get(
  '/',
  requireRole(...READ_ROLES),
  validate({ query: listSupplierPaymentsQuerySchema }),
  listSupplierPaymentsHandler
);

router.get(
  '/:id',
  requireRole(...READ_ROLES),
  validate({ params: supplierPaymentIdParamSchema }),
  getSupplierPaymentHandler
);

export default router;
