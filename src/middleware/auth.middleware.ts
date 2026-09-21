import type { NextFunction, Request, Response } from 'express';
import { Types } from 'mongoose';
import { UnauthorizedError } from '../utils/errors';
import { verifyAccessToken } from '../utils/jwt';
import { User } from '../models/user.model';
import { AccountStatus, type UserRole } from '../types/enums';
import { Tenant } from '../models/tenant.model';

// Verifies the JWT and re-checks live account/tenant status on every request
// so a suspend/deactivate takes effect immediately, even for a still-valid token.
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing bearer token');
    }
    const token = header.slice('Bearer '.length);

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch {
      throw new UnauthorizedError('Invalid or expired token');
    }

    const user = await User.findById(payload.sub).select('status role tenantId');
    if (!user || user.status !== AccountStatus.ACTIVE) {
      throw new UnauthorizedError('Account is not active');
    }

    if (user.tenantId) {
      const tenant = await Tenant.findById(user.tenantId).select('status');
      if (!tenant || tenant.status !== AccountStatus.ACTIVE) {
        throw new UnauthorizedError('Business account is not active');
      }
    }

    req.user = {
      userId: user._id as Types.ObjectId,
      tenantId: user.tenantId as Types.ObjectId | null,
      role: user.role as UserRole,
    };

    next();
  } catch (err) {
    next(err);
  }
}
