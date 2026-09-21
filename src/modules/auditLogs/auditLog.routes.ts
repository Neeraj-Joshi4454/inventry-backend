import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/role.middleware';
import { validate } from '../../middleware/validation.middleware';
import { UserRole } from '../../types/enums';
import { listAuditLogsQuerySchema } from './auditLog.validators';
import { listAuditLogsHandler } from './auditLog.controller';

const router = Router();

// SUPER_ADMIN gets platform-wide visibility; OWNER/MANAGER get a
// read-only view of their own tenant's log (see auditLog.controller.ts for
// how the filter is forced per role) — deliberately not open to every
// role, since the log includes every financial/stock action.
router.use(authenticate);

router.get(
  '/',
  requireRole(UserRole.SUPER_ADMIN, UserRole.OWNER, UserRole.MANAGER),
  validate({ query: listAuditLogsQuerySchema }),
  listAuditLogsHandler
);

export default router;
