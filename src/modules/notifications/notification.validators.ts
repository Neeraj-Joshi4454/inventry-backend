import { z } from 'zod';
import { paginationQuerySchema } from '../../utils/pagination';

export const listNotificationsQuerySchema = paginationQuerySchema.extend({
  unreadOnly: z.coerce.boolean().optional(),
});

export const notificationIdParamSchema = z.object({
  id: z.string().min(1),
});

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;
