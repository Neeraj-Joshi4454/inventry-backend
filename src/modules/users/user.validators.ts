import { z } from 'zod';
import { AccountStatus, UserRole } from '../../types/enums';
import { mobileNumberSchema } from '../../utils/mobileNumber';
import { passwordSchema } from '../../utils/passwordPolicy';
import { paginationQuerySchema } from '../../utils/pagination';

// SUPER_ADMIN is deliberately excluded from every role assignment surface
// in the app — the only way a SUPER_ADMIN account can ever be created is
// the seed script (scripts/bootstrapSuperAdmin.ts), never an API call.
const assignableRoleSchema = z.enum([
  UserRole.OWNER,
  UserRole.MANAGER,
  UserRole.STORE_KEEPER,
  UserRole.SALES_PERSON,
  UserRole.ACCOUNTANT,
]);

export const createUserSchema = z.object({
  tenantId: z.string().min(1, 'tenantId is required'),
  name: z.string().min(1),
  mobileNumber: mobileNumberSchema,
  password: passwordSchema,
  role: assignableRoleSchema,
});

export const updateUserSchema = z
  .object({
    name: z.string().min(1).optional(),
    role: assignableRoleSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'No fields to update' });

export const updateUserStatusSchema = z.object({
  status: z.enum([AccountStatus.ACTIVE, AccountStatus.INACTIVE, AccountStatus.SUSPENDED]),
});

export const resetPasswordSchema = z.object({
  newPassword: passwordSchema,
});

export const userIdParamSchema = z.object({
  id: z.string().min(1),
});

export const listUsersQuerySchema = paginationQuerySchema.extend({
  tenantId: z.string().optional(),
  role: assignableRoleSchema.optional(),
  status: z
    .enum([AccountStatus.ACTIVE, AccountStatus.INACTIVE, AccountStatus.SUSPENDED])
    .optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type UpdateUserStatusInput = z.infer<typeof updateUserStatusSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
