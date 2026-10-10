import { z } from 'zod';
import { InventoryTransactionType } from '../../types/enums';
import { paginationQuerySchema } from '../../utils/pagination';

const STOCK_STATUS_VALUES = ['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK'] as const;

export const listInventoryQuerySchema = paginationQuerySchema.extend({
  search: z.string().optional(),
  categoryId: z.string().optional(),
  status: z.enum(STOCK_STATUS_VALUES).optional(),
  // Only products with stock on hand — what the sale screen's picker uses,
  // so anything purchased into inventory (low stock included) is sellable.
  inStock: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

export const productIdParamSchema = z.object({
  productId: z.string().min(1),
});

export const listTransactionsQuerySchema = paginationQuerySchema.extend({
  type: z.enum(Object.values(InventoryTransactionType) as [string, ...string[]]).optional(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
});

export type ListInventoryQuery = z.infer<typeof listInventoryQuerySchema>;
export type ListTransactionsQuery = z.infer<typeof listTransactionsQuerySchema>;
export type StockStatus = (typeof STOCK_STATUS_VALUES)[number];
