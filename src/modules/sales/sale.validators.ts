import { z } from 'zod';
import { PaymentMethod } from '../../types/enums';
import { paginationQuerySchema } from '../../utils/pagination';

export const createSaleSchema = z.object({
  customerId: z.string().min(1),
  saleDate: z.coerce.date().optional(),
  discountAmount: z.number().min(0).default(0),
  // Optional / defaulted so existing callers that don't send payment info
  // yet (or ever) keep working exactly as before: an omitted paidAmount is
  // a credit sale, same as today.
  paidAmount: z.number().min(0).default(0),
  paymentMethod: z.enum(Object.values(PaymentMethod) as [string, ...string[]]).optional(),
  notes: z.string().optional(),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().positive('Quantity must be greater than zero'),
        unitPrice: z.number().min(0),
        // Optional — omitted means "use this product's own configured
        // taxRate" (see sale.service.ts::createSale). An explicit value
        // always overrides the product default for this one line.
        taxRate: z.number().min(0).optional(),
        // Whether `unitPrice` above already includes tax. Defaults to the
        // product's own isPriceInclusive setting when omitted.
        isPriceInclusive: z.boolean().optional(),
      })
    )
    .min(1, 'A sale must have at least one item'),
});

export const saleIdParamSchema = z.object({
  id: z.string().min(1),
});

export const listSalesQuerySchema = paginationQuerySchema.extend({
  search: z.string().optional(),
  customerId: z.string().optional(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
});

export const createSaleReturnSchema = z.object({
  notes: z.string().optional(),
  items: z
    .array(
      z.object({
        saleItemId: z.string().min(1),
        quantity: z.number().positive('Return quantity must be greater than zero'),
      })
    )
    .min(1, 'A return must have at least one item'),
});

export type CreateSaleInput = z.infer<typeof createSaleSchema>;
export type ListSalesQuery = z.infer<typeof listSalesQuerySchema>;
export type CreateSaleReturnInput = z.infer<typeof createSaleReturnSchema>;
