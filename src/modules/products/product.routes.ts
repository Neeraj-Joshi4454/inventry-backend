import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/role.middleware';
import { requireTenantContext, stripClientTenantId } from '../../middleware/tenant.middleware';
import { validate } from '../../middleware/validation.middleware';
import { UserRole } from '../../types/enums';
import {
  createProductSchema,
  listProductsQuerySchema,
  productIdParamSchema,
  updateProductSchema,
} from './product.validators';
import {
  createProductHandler,
  getProductHandler,
  listProductsHandler,
  updateProductHandler,
} from './product.controller';

const router = Router();

router.use(authenticate, requireTenantContext, stripClientTenantId);

const WRITE_ROLES = [UserRole.OWNER, UserRole.MANAGER, UserRole.STORE_KEEPER] as const;

router.post(
  '/',
  requireRole(...WRITE_ROLES),
  validate({ body: createProductSchema }),
  createProductHandler
);

// Every business role can browse products (needed while recording a sale/purchase).
router.get('/', validate({ query: listProductsQuerySchema }), listProductsHandler);
router.get('/:id', validate({ params: productIdParamSchema }), getProductHandler);

router.patch(
  '/:id',
  requireRole(...WRITE_ROLES),
  validate({ params: productIdParamSchema, body: updateProductSchema }),
  updateProductHandler
);

export default router;
