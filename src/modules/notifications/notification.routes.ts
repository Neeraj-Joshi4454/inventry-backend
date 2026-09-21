import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { requireTenantContext, stripClientTenantId } from '../../middleware/tenant.middleware';
import { validate } from '../../middleware/validation.middleware';
import {
  listNotificationsQuerySchema,
  notificationIdParamSchema,
} from './notification.validators';
import {
  listNotificationsHandler,
  markAllNotificationsReadHandler,
  markNotificationReadHandler,
} from './notification.controller';

const router = Router();

router.use(authenticate, requireTenantContext, stripClientTenantId);

// Every tenant-scoped role can see and dismiss their own tenant's alerts —
// these are operational stock alerts, not a sensitive financial view.
router.get('/', validate({ query: listNotificationsQuerySchema }), listNotificationsHandler);
router.patch(
  '/:id/read',
  validate({ params: notificationIdParamSchema }),
  markNotificationReadHandler
);
router.patch('/read-all', markAllNotificationsReadHandler);

export default router;
