import { z } from 'zod';
import { InventoryTransactionType } from '../../types/enums';
import { paginationQuerySchema } from '../../utils/pagination';

export const openingStockSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().positive('Opening stock quantity must be greater than zero'),
  notes: z.string().optional(),
});

const STOCK_STATUS_VALUES = ['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK'] as const;

export const listInventoryQuerySchema = paginationQuerySchema.extend({
  search: z.string().optional(),
  categoryId: z.string().optional(),
  status: z.enum(STOCK_STATUS_VALUES).optional(),
});

export const productIdParamSchema = z.object({
  productId: z.string().min(1),
});

export const listTransactionsQuerySchema = paginationQuerySchema.extend({
  type: z.enum(Object.values(InventoryTransactionType) as [string, ...string[]]).optional(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
});

export type OpeningStockInput = z.infer<typeof openingStockSchema>;
export type ListInventoryQuery = z.infer<typeof listInventoryQuerySchema>;
export type ListTransactionsQuery = z.infer<typeof listTransactionsQuerySchema>;
export type StockStatus = (typeof STOCK_STATUS_VALUES)[number];
