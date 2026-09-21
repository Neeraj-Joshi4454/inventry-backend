import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/role.middleware';
import { requireTenantContext, stripClientTenantId } from '../../middleware/tenant.middleware';
import { validate } from '../../middleware/validation.middleware';
import { UserRole } from '../../types/enums';
import { createUnitSchema } from './unit.validators';
import { createUnitHandler, listUnitsHandler } from './unit.controller';

const router = Router();

router.use(authenticate, requireTenantContext, stripClientTenantId);
router.get('/', listUnitsHandler);

router.post(
  '/',
  requireRole(UserRole.OWNER, UserRole.MANAGER, UserRole.STORE_KEEPER),
  validate({ body: createUnitSchema }),
  createUnitHandler
);

export default router;
