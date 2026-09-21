import type { NextFunction, Request, Response } from 'express';
import { ForbiddenError } from '../utils/errors';

/**
 * Guards routes that only make sense for tenant-scoped users (i.e. every
 * role except SUPER_ADMIN, whose req.user.tenantId is null). Mount after
 * `authenticate`.
 */
export function requireTenantContext(req: Request, _res: Response, next: NextFunction) {
  if (!req.user?.tenantId) {
    next(new ForbiddenError('This action requires a business (tenant) account'));
    return;
  }
  next();
}

const TENANT_ID_KEYS = ['tenantId', 'tenant_id'];

/**
 * Defense-in-depth: strips any client-supplied tenantId from body/query/
 * params on tenant-scoped routes before the request reaches a controller.
 * tenantId must NEVER be read from client input — it is always derived
 * from `req.user.tenantId`, set by `authenticate` from the verified JWT.
 * This middleware exists so a controller that (by mistake) spreads
 * `req.body` into a create/update call can't be tricked into writing a
 * document under a different tenant.
 */
export function stripClientTenantId(req: Request, _res: Response, next: NextFunction) {
  for (const key of TENANT_ID_KEYS) {
    if (req.body && typeof req.body === 'object') delete (req.body as Record<string, unknown>)[key];
    if (req.query && typeof req.query === 'object')
      delete (req.query as Record<string, unknown>)[key];
  }
  next();
}
