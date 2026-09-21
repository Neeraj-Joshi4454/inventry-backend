import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/role.middleware';
import { requireTenantContext, stripClientTenantId } from '../../middleware/tenant.middleware';
import { validate } from '../../middleware/validation.middleware';
import { UserRole } from '../../types/enums';
import {
  listCustomerPaymentsQuerySchema,
  paymentIdParamSchema,
  recordCustomerPaymentSchema,
} from './customerPayment.validators';
import {
  getCustomerPaymentHandler,
  listCustomerPaymentsHandler,
  recordCustomerPaymentHandler,
} from './customerPayment.controller';

const router = Router();

router.use(authenticate, requireTenantContext, stripClientTenantId);

// Matches sale.routes.ts's role sets — whoever can create/view a sale can
// record/view payments against it.
const WRITE_ROLES = [
  UserRole.OWNER,
  UserRole.MANAGER,
  UserRole.STORE_KEEPER,
  UserRole.SALES_PERSON,
] as const;
const READ_ROLES = [...WRITE_ROLES, UserRole.ACCOUNTANT] as const;

router.post(
  '/',
  requireRole(...WRITE_ROLES),
  validate({ body: recordCustomerPaymentSchema }),
  recordCustomerPaymentHandler
);

router.get(
  '/',
  requireRole(...READ_ROLES),
  validate({ query: listCustomerPaymentsQuerySchema }),
  listCustomerPaymentsHandler
);

router.get(
  '/:id',
  requireRole(...READ_ROLES),
  validate({ params: paymentIdParamSchema }),
  getCustomerPaymentHandler
);

export default router;
