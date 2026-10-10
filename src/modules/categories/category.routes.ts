import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/role.middleware';
import { requireTenantContext, stripClientTenantId } from '../../middleware/tenant.middleware';
import { validate } from '../../middleware/validation.middleware';
import { UserRole } from '../../types/enums';
import { createCategorySchema, categoryIdParamSchema } from './category.validators';
import {
  createCategoryHandler,
  deleteCategoryHandler,
  listCategoriesHandler,
} from './category.controller';

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

router.delete(
  '/:id',
  requireRole(UserRole.OWNER, UserRole.MANAGER),
  validate({ params: categoryIdParamSchema }),
  deleteCategoryHandler
);

export default router;
