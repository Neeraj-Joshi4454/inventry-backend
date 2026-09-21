import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';

/**
 * Placeholder for a module whose route path is reserved (see the API
 * architecture in the project's architecture doc) but whose business logic
 * hasn't been built yet. Still requires authentication, so the route's
 * existence doesn't become an unauthenticated probe target, and returns a
 * 501 in the app's standard error envelope rather than falling through to
 * the generic 404 handler — the distinction matters to a frontend dev
 * checking "is this endpoint not built yet, or just wrong?".
 */
export function notImplementedRouter(moduleName: string) {
  const router = Router();
  router.use(authenticate, (_req, res) => {
    res.status(501).json({
      success: false,
      message: `${moduleName} module is not implemented yet`,
      errors: [],
    });
  });
  return router;
}
