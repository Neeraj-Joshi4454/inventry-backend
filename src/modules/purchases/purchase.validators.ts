import { z } from 'zod';
import { PaymentMethod } from '../../types/enums';
import { paginationQuerySchema } from '../../utils/pagination';

export const listPurchasesQuerySchema = paginationQuerySchema.extend({
  search: z.string().optional(),
  supplierId: z.string().optional(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
});

export const createPurchaseSchema = z
  .object({
    supplierId: z.string().min(1),
    invoiceNumber: z.string().optional(),
    purchaseDate: z.coerce.date().optional(),
    discountAmount: z.number().min(0).default(0),
    // Same contract as createSaleSchema: omitted paidAmount = nothing paid
    // yet (UNPAID), so existing callers keep working unchanged.
    paidAmount: z.number().min(0).default(0),
    paymentMethod: z.enum(Object.values(PaymentMethod) as [string, ...string[]]).optional(),
    // Reference for the payment to the supplier (UPI txn id, UTR, card slip no.).
    paymentReference: z.string().trim().max(100).optional(),
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
  })
  .refine(
    (purchase) => !(purchase.paidAmount > 0 && purchase.paymentMethod === PaymentMethod.CREDIT),
    {
      message:
        'Choose how the amount was paid (cash, UPI, bank transfer or card) — credit cannot be a payment mode',
      path: ['paymentMethod'],
    }
  );

export const purchaseIdParamSchema = z.object({
  id: z.string().min(1),
});

export type CreatePurchaseInput = z.infer<typeof createPurchaseSchema>;
export type ListPurchasesQuery = z.infer<typeof listPurchasesQuerySchema>;
