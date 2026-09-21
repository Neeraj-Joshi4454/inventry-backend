import { z } from 'zod';
import { ExpensePaymentMethod, InventoryTransactionType } from '../../types/enums';
import { paginationQuerySchema } from '../../utils/pagination';

// Validated up front (rather than left to `new Types.ObjectId(str)` at
// query time) so a malformed id in a filter produces the same clean 400
// validation response as every other endpoint, instead of an uncaught
// BSON error falling through to the generic 500 handler.
const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

const dateRangeShape = {
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
};

export const salesReportQuerySchema = paginationQuerySchema.extend({
  ...dateRangeShape,
  customerId: objectIdSchema.optional(),
  productId: objectIdSchema.optional(),
});

export const purchaseReportQuerySchema = paginationQuerySchema.extend({
  ...dateRangeShape,
  supplierId: objectIdSchema.optional(),
  productId: objectIdSchema.optional(),
});

const STOCK_STATUS_VALUES = ['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK'] as const;

export const stockReportQuerySchema = paginationQuerySchema.extend({
  categoryId: objectIdSchema.optional(),
  status: z.enum(STOCK_STATUS_VALUES).optional(),
  search: z.string().optional(),
});

export const inventoryLedgerReportQuerySchema = paginationQuerySchema.extend({
  ...dateRangeShape,
  productId: objectIdSchema.optional(),
  type: z.enum(Object.values(InventoryTransactionType) as [string, ...string[]]).optional(),
});

export const profitReportQuerySchema = z.object(dateRangeShape);

export const dashboardSummaryQuerySchema = z.object({});

export const outstandingCustomersReportQuerySchema = paginationQuerySchema.extend({
  search: z.string().optional(),
});

export const expenseReportQuerySchema = paginationQuerySchema.extend({
  ...dateRangeShape,
  categoryId: objectIdSchema.optional(),
  paymentMethod: z.enum(Object.values(ExpensePaymentMethod) as [string, ...string[]]).optional(),
});

export type SalesReportQuery = z.infer<typeof salesReportQuerySchema>;
export type PurchaseReportQuery = z.infer<typeof purchaseReportQuerySchema>;
export type StockReportQuery = z.infer<typeof stockReportQuerySchema>;
export type InventoryLedgerReportQuery = z.infer<typeof inventoryLedgerReportQuerySchema>;
export type ProfitReportQuery = z.infer<typeof profitReportQuerySchema>;
export type OutstandingCustomersReportQuery = z.infer<typeof outstandingCustomersReportQuerySchema>;
export type ExpenseReportQuery = z.infer<typeof expenseReportQuerySchema>;
