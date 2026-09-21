import type { Types } from 'mongoose';
import type { UserRole } from './enums';

export interface AuthenticatedUser {
  userId: Types.ObjectId;
  tenantId: Types.ObjectId | null; // null only for SUPER_ADMIN
  role: UserRole;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export {};
