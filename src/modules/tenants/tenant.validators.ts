import { z } from 'zod';
import { AccountStatus } from '../../types/enums';
import { mobileNumberSchema } from '../../utils/mobileNumber';
import { passwordSchema } from '../../utils/passwordPolicy';
import { paginationQuerySchema } from '../../utils/pagination';

const addressSchema = z.object({
  line1: z.string().optional(),
  line2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  pincode: z.string().optional(),
});

export const createTenantSchema = z.object({
  businessName: z.string().min(1),
  ownerName: z.string().min(1),
  businessMobileNumber: mobileNumberSchema,
  email: z.string().email().optional(),
  gstNumber: z.string().optional(),
  address: addressSchema.optional(),
  // Initial OWNER user, created atomically with the tenant.
  adminUser: z.object({
    name: z.string().min(1),
    mobileNumber: mobileNumberSchema,
    password: passwordSchema,
  }),
});

export const updateTenantStatusSchema = z.object({
  status: z.enum([AccountStatus.ACTIVE, AccountStatus.INACTIVE, AccountStatus.SUSPENDED]),
});

// Business-detail edits only — never status (that's the dedicated status
// endpoint, which also carries session-revocation-adjacent side effects)
// and never the tenant's owner/user records (those are managed via /users).
export const updateTenantSchema = z
  .object({
    businessName: z.string().min(1).optional(),
    ownerName: z.string().min(1).optional(),
    businessMobileNumber: mobileNumberSchema.optional(),
    email: z.string().email().optional(),
    gstNumber: z.string().optional(),
    address: addressSchema.optional(),
    invoicePrefix: z.string().min(1).max(10).optional(),
    invoiceFooterNote: z.string().max(500).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'No fields to update' });

export const tenantIdParamSchema = z.object({
  tenantId: z.string().min(1),
});

export const listTenantsQuerySchema = paginationQuerySchema.extend({
  status: z
    .enum([AccountStatus.ACTIVE, AccountStatus.INACTIVE, AccountStatus.SUSPENDED])
    .optional(),
  search: z.string().optional(),
  sortBy: z.enum(['businessName', 'createdAt', 'status']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

export type CreateTenantInput = z.infer<typeof createTenantSchema>;
export type ListTenantsQuery = z.infer<typeof listTenantsQuerySchema>;
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;
