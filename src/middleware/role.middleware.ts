import type { NextFunction, Request, Response } from 'express';
import { ForbiddenError, UnauthorizedError } from '../utils/errors';
import type { UserRole } from '../types/enums';

/**
 * Route-level RBAC gate. Reusable across every module so authorization
 * checks never get hard-coded inline inside individual controllers.
 *
 * Usage:
 *   router.post('/', authenticate, requireRole('OWNER', 'MANAGER'), handler)
 *   router.get('/', authenticate, requireRole('SUPER_ADMIN'), handler)
 */
export function requireRole(...allowedRoles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      next(new UnauthorizedError());
      return;
    }
    if (!allowedRoles.includes(req.user.role)) {
      next(new ForbiddenError('You do not have permission to perform this action'));
      return;
    }
    next();
  };
}
