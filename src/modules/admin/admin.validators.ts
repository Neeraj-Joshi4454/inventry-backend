import { z } from 'zod';
import { PaymentStatus } from '../../types/enums';
import { paginationQuerySchema } from '../../utils/pagination';

// Validated as a real ObjectId up front so a bad id is a 400, not a
// BSONError thrown from `new Types.ObjectId(...)` deep in a pipeline.
const objectIdSchema = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');

const tenantFilter = { tenantId: objectIdSchema.optional() };
const searchFilter = { search: z.string().trim().max(100).optional() };
const dateRange = {
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
};

export const tenantIdParamSchema = z.object({ tenantId: objectIdSchema });

export const listAdminProductsQuerySchema = paginationQuerySchema.extend({
  ...tenantFilter,
  ...searchFilter,
  isActive: z.enum(['true', 'false']).optional(),
});

export const listAdminInventoryQuerySchema = paginationQuerySchema.extend({
  ...tenantFilter,
  ...searchFilter,
  status: z.enum(['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK']).optional(),
});

export const listAdminDocumentsQuerySchema = paginationQuerySchema.extend({
  ...tenantFilter,
  ...searchFilter,
  ...dateRange,
  paymentStatus: z.enum(Object.values(PaymentStatus) as [string, ...string[]]).optional(),
});

export const adminReportQuerySchema = z.object({ ...dateRange });

export type ListAdminProductsQuery = z.infer<typeof listAdminProductsQuerySchema>;
export type ListAdminInventoryQuery = z.infer<typeof listAdminInventoryQuerySchema>;
export type ListAdminDocumentsQuery = z.infer<typeof listAdminDocumentsQuerySchema>;
export type AdminReportQuery = z.infer<typeof adminReportQuerySchema>;
