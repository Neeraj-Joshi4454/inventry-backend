import { z } from 'zod';
import { PaymentMethod } from '../../types/enums';
import { paginationQuerySchema } from '../../utils/pagination';

// CREDIT means "nothing paid" — it can never be the method of a real payment.
const paidMethods = Object.values(PaymentMethod).filter((m) => m !== PaymentMethod.CREDIT) as [
  string,
  ...string[],
];

export const recordCustomerPaymentSchema = z.object({
  saleId: z.string().min(1),
  amount: z.number().positive('Payment amount must be greater than zero'),
  method: z.enum(paidMethods),
  paymentDate: z.coerce.date().optional(),
  referenceNumber: z.string().trim().max(100).optional(),
  notes: z.string().optional(),
});

export const listCustomerPaymentsQuerySchema = paginationQuerySchema.extend({
  customerId: z.string().optional(),
  saleId: z.string().optional(),
  method: z.enum(Object.values(PaymentMethod) as [string, ...string[]]).optional(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
});

export const paymentIdParamSchema = z.object({
  id: z.string().min(1),
});

export type RecordCustomerPaymentInput = z.infer<typeof recordCustomerPaymentSchema>;
export type ListCustomerPaymentsQuery = z.infer<typeof listCustomerPaymentsQuerySchema>;
