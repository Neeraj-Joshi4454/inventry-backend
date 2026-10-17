import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { registrationRateLimiter } from '../../middleware/rateLimiter.middleware';
import { requireRole } from '../../middleware/role.middleware';
import { validate } from '../../middleware/validation.middleware';
import { UserRole } from '../../types/enums';
import {
  createRegistrationSchema,
  listRegistrationsQuerySchema,
  registrationIdParamSchema,
  rejectRegistrationSchema,
} from './registration.validators';
import {
  approveRegistrationHandler,
  listRegistrationsHandler,
  pendingCountHandler,
  rejectRegistrationHandler,
  submitRegistrationHandler,
} from './registration.controller';

const router = Router();

// Public — this is how a business that has no account yet asks for one.
router.post(
  '/',
  registrationRateLimiter,
  validate({ body: createRegistrationSchema }),
  submitRegistrationHandler
);

// Reviewing requests is SUPER_ADMIN-only.
router.use(authenticate, requireRole(UserRole.SUPER_ADMIN));

router.get('/', validate({ query: listRegistrationsQuerySchema }), listRegistrationsHandler);
router.get('/pending-count', pendingCountHandler);
router.post(
  '/:id/approve',
  validate({ params: registrationIdParamSchema }),
  approveRegistrationHandler
);
router.post(
  '/:id/reject',
  validate({ params: registrationIdParamSchema, body: rejectRegistrationSchema }),
  rejectRegistrationHandler
);

export default router;
