import { z } from 'zod';
import { paginationQuerySchema } from '../../utils/pagination';

const addressSchema = z.object({
  line1: z.string().optional(),
  line2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  pincode: z.string().optional(),
});

export const createSupplierSchema = z.object({
  name: z.string().min(1, 'Supplier name is required'),
  contactPerson: z.string().optional(),
  mobileNumber: z.string().optional(),
  email: z.string().email().optional(),
  address: addressSchema.optional(),
  gstNumber: z.string().optional(),
  notes: z.string().optional(),
});

export const updateSupplierSchema = createSupplierSchema.partial();

export const setSupplierStatusSchema = z.object({
  isActive: z.boolean(),
});

export const listSuppliersQuerySchema = paginationQuerySchema.extend({
  search: z.string().optional(),
  // Defaults to active-only at the service layer (matches the previous
  // behavior every other caller — the purchase-creation supplier picker,
  // etc. — already relies on); passing status=all or status=inactive opts
  // into seeing deactivated suppliers too, for the Suppliers management screen.
  status: z.enum(['active', 'inactive', 'all']).optional(),
});

export const supplierIdParamSchema = z.object({
  id: z.string().min(1),
});

export const supplierPurchaseHistoryQuerySchema = paginationQuerySchema.extend({
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
});

export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;
export type SetSupplierStatusInput = z.infer<typeof setSupplierStatusSchema>;
export type ListSuppliersQuery = z.infer<typeof listSuppliersQuerySchema>;
export type SupplierPurchaseHistoryQuery = z.infer<typeof supplierPurchaseHistoryQuerySchema>;
