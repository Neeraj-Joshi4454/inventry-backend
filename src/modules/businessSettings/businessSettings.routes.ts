import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/role.middleware';
import { requireTenantContext, stripClientTenantId } from '../../middleware/tenant.middleware';
import { validate } from '../../middleware/validation.middleware';
import { UserRole } from '../../types/enums';
import { updateTenantSchema } from '../tenants/tenant.validators';
import {
  getBusinessSettingsHandler,
  updateBusinessSettingsHandler,
} from './businessSettings.controller';

const router = Router();

router.use(authenticate, requireTenantContext, stripClientTenantId);

router.get('/', requireRole(UserRole.OWNER, UserRole.MANAGER), getBusinessSettingsHandler);
router.patch(
  '/',
  requireRole(UserRole.OWNER),
  validate({ body: updateTenantSchema }),
  updateBusinessSettingsHandler
);

export default router;
