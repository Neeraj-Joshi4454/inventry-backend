import { z } from 'zod';
import { PaymentMethod } from '../../types/enums';
import { paginationQuerySchema } from '../../utils/pagination';

// CREDIT means "nothing paid" — it can never be the method of a real payment.
const paidMethods = Object.values(PaymentMethod).filter((m) => m !== PaymentMethod.CREDIT) as [
  string,
  ...string[],
];

export const recordSupplierPaymentSchema = z.object({
  purchaseId: z.string().min(1),
  amount: z.number().positive('Payment amount must be greater than zero'),
  method: z.enum(paidMethods),
  paymentDate: z.coerce.date().optional(),
  referenceNumber: z.string().trim().max(100).optional(),
  notes: z.string().optional(),
});

export const listSupplierPaymentsQuerySchema = paginationQuerySchema.extend({
  supplierId: z.string().optional(),
  purchaseId: z.string().optional(),
  method: z.enum(Object.values(PaymentMethod) as [string, ...string[]]).optional(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
});

export const supplierPaymentIdParamSchema = z.object({
  id: z.string().min(1),
});

export type RecordSupplierPaymentInput = z.infer<typeof recordSupplierPaymentSchema>;
export type ListSupplierPaymentsQuery = z.infer<typeof listSupplierPaymentsQuerySchema>;
