import { z } from 'zod';
import { paginationQuerySchema } from '../../utils/pagination';

export const listAuditLogsQuerySchema = paginationQuerySchema.extend({
  tenantId: z.string().optional(),
});

export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;
