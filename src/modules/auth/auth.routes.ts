import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { authRateLimiter, loginRateLimiter } from '../../middleware/rateLimiter.middleware';
import { validate } from '../../middleware/validation.middleware';
import { changePasswordSchema, loginSchema, logoutSchema, refreshSchema } from './auth.validators';
import {
  changePasswordHandler,
  loginHandler,
  logoutHandler,
  meHandler,
  refreshHandler,
} from './auth.controller';

const router = Router();

router.post('/login', loginRateLimiter, validate({ body: loginSchema }), loginHandler);
router.post('/refresh', authRateLimiter, validate({ body: refreshSchema }), refreshHandler);

// Not gated behind authenticate: a client whose access token has already
// expired must still be able to log out using a still-valid refresh token.
// The refresh token itself is what's validated and revoked.
router.post('/logout', authRateLimiter, validate({ body: logoutSchema }), logoutHandler);

router.get('/me', authenticate, meHandler);
router.post(
  '/change-password',
  authenticate,
  authRateLimiter,
  validate({ body: changePasswordSchema }),
  changePasswordHandler
);

export default router;
