import { z } from 'zod';
import { paginationQuerySchema } from '../../utils/pagination';

const addressSchema = z.object({
  line1: z.string().optional(),
  line2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  pincode: z.string().optional(),
});

export const createCustomerSchema = z.object({
  name: z.string().min(1),
  mobileNumber: z.string().optional(),
  email: z.string().email().optional(),
  address: addressSchema.optional(),
  gstNumber: z.string().optional(),
  notes: z.string().optional(),
});

export const updateCustomerSchema = createCustomerSchema.partial();

export const setCustomerStatusSchema = z.object({
  isActive: z.boolean(),
});

export const listCustomersQuerySchema = paginationQuerySchema.extend({
  search: z.string().optional(),
});

export const customerIdParamSchema = z.object({
  id: z.string().min(1),
});

export const customerSalesHistoryQuerySchema = paginationQuerySchema.extend({
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
export type SetCustomerStatusInput = z.infer<typeof setCustomerStatusSchema>;
export type ListCustomersQuery = z.infer<typeof listCustomersQuerySchema>;
export type CustomerSalesHistoryQuery = z.infer<typeof customerSalesHistoryQuerySchema>;
