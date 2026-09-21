import { z } from 'zod';
import { paginationQuerySchema } from '../../utils/pagination';

export const listPurchasesQuerySchema = paginationQuerySchema.extend({
  search: z.string().optional(),
  supplierId: z.string().optional(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
});

export const createPurchaseSchema = z.object({
  supplierId: z.string().min(1),
  invoiceNumber: z.string().optional(),
  purchaseDate: z.coerce.date().optional(),
  discountAmount: z.number().min(0).default(0),
  notes: z.string().optional(),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().positive('Quantity must be greater than zero'),
        unitPrice: z.number().min(0),
        // Optional — omitted means "use this product's own configured
        // taxRate" (see purchase.service.ts::createPurchase).
        taxRate: z.number().min(0).optional(),
        // Whether `unitPrice` above already includes tax. Defaults to the
        // product's own isPriceInclusive setting when omitted.
        isPriceInclusive: z.boolean().optional(),
      })
    )
    .min(1, 'A purchase must have at least one item'),
});

export const purchaseIdParamSchema = z.object({
  id: z.string().min(1),
});

export const createPurchaseReturnSchema = z.object({
  notes: z.string().optional(),
  items: z
    .array(
      z.object({
        purchaseItemId: z.string().min(1),
        quantity: z.number().positive('Return quantity must be greater than zero'),
      })
    )
    .min(1, 'A return must have at least one item'),
});

export type CreatePurchaseInput = z.infer<typeof createPurchaseSchema>;
export type CreatePurchaseReturnInput = z.infer<typeof createPurchaseReturnSchema>;
export type ListPurchasesQuery = z.infer<typeof listPurchasesQuerySchema>;
