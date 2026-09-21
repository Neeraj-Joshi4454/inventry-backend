import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/role.middleware';
import { validate } from '../../middleware/validation.middleware';
import { UserRole } from '../../types/enums';
import {
  createTenantSchema,
  listTenantsQuerySchema,
  tenantIdParamSchema,
  updateTenantSchema,
  updateTenantStatusSchema,
} from './tenant.validators';
import {
  createTenantHandler,
  listTenantsHandler,
  updateTenantHandler,
  updateTenantStatusHandler,
} from './tenant.controller';

const router = Router();

// Every route on this router is SUPER_ADMIN-only — tenant management is a
// platform-level operation, never a business-user one.
router.use(authenticate, requireRole(UserRole.SUPER_ADMIN));

router.post('/', validate({ body: createTenantSchema }), createTenantHandler);
router.get('/', validate({ query: listTenantsQuerySchema }), listTenantsHandler);
router.patch(
  '/:tenantId',
  validate({ params: tenantIdParamSchema, body: updateTenantSchema }),
  updateTenantHandler
);
router.patch(
  '/:tenantId/status',
  validate({ params: tenantIdParamSchema, body: updateTenantStatusSchema }),
  updateTenantStatusHandler
);

export default router;
