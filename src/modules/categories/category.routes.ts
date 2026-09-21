import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/role.middleware';
import { requireTenantContext, stripClientTenantId } from '../../middleware/tenant.middleware';
import { validate } from '../../middleware/validation.middleware';
import { UserRole } from '../../types/enums';
import { createCategorySchema } from './category.validators';
import { createCategoryHandler, listCategoriesHandler } from './category.controller';

const router = Router();

router.use(authenticate, requireTenantContext, stripClientTenantId);

// Every business role can read the category list (needed for filters/pickers).
router.get('/', listCategoriesHandler);

router.post(
  '/',
  requireRole(UserRole.OWNER, UserRole.MANAGER, UserRole.STORE_KEEPER),
  validate({ body: createCategorySchema }),
  createCategoryHandler
);

export default router;
