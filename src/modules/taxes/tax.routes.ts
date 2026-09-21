import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/role.middleware';
import { requireTenantContext, stripClientTenantId } from '../../middleware/tenant.middleware';
import { validate } from '../../middleware/validation.middleware';
import { UserRole } from '../../types/enums';
import { updateTaxConfigSchema } from './tax.validators';
import { getTaxConfigHandler, updateTaxConfigHandler } from './tax.controller';

const router = Router();

router.use(authenticate, requireTenantContext, stripClientTenantId);

// Tax configuration affects every future sale/purchase's totals — an
// Owner/Manager-only setting, same write role set as Tax's closest
// relative, expense categories.
const READ_ROLES = [UserRole.OWNER, UserRole.MANAGER, UserRole.ACCOUNTANT] as const;
const WRITE_ROLES = [UserRole.OWNER, UserRole.MANAGER] as const;

router.get('/', requireRole(...READ_ROLES), getTaxConfigHandler);
router.patch(
  '/',
  requireRole(...WRITE_ROLES),
  validate({ body: updateTaxConfigSchema }),
  updateTaxConfigHandler
);

export default router;
