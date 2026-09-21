import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/role.middleware';
import { validate } from '../../middleware/validation.middleware';
import { UserRole } from '../../types/enums';
import {
  createUserSchema,
  listUsersQuerySchema,
  resetPasswordSchema,
  updateUserSchema,
  updateUserStatusSchema,
  userIdParamSchema,
} from './user.validators';
import {
  createUserHandler,
  getUserHandler,
  listUsersHandler,
  resetUserPasswordHandler,
  updateUserHandler,
  updateUserStatusHandler,
} from './user.controller';

const router = Router();

// Business-user management (create/list/update/status/reset-password) is a
// platform-level operation — only SUPER_ADMIN can manage users across
// tenants. Tenant-scoped self-service (viewing your own profile, changing
// your own password) lives under /api/v1/auth instead.
router.use(authenticate, requireRole(UserRole.SUPER_ADMIN));

router.post('/', validate({ body: createUserSchema }), createUserHandler);
router.get('/', validate({ query: listUsersQuerySchema }), listUsersHandler);
router.get('/:id', validate({ params: userIdParamSchema }), getUserHandler);
router.patch(
  '/:id',
  validate({ params: userIdParamSchema, body: updateUserSchema }),
  updateUserHandler
);
router.patch(
  '/:id/status',
  validate({ params: userIdParamSchema, body: updateUserStatusSchema }),
  updateUserStatusHandler
);
router.post(
  '/:id/reset-password',
  validate({ params: userIdParamSchema, body: resetPasswordSchema }),
  resetUserPasswordHandler
);

export default router;
