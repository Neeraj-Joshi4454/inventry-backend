import { z } from 'zod';
import { RegistrationStatus } from '../../types/enums';
import { mobileNumberSchema } from '../../utils/mobileNumber';
import { paginationQuerySchema } from '../../utils/pagination';
import { passwordSchema } from '../../utils/passwordPolicy';

// The same fields the admin panel's "New Business" form collects — the
// mobile number doubles as the business contact and the owner's login.
export const createRegistrationSchema = z.object({
  businessName: z.string().trim().min(1, 'Business name is required').max(120),
  ownerName: z.string().trim().min(1, 'Owner name is required').max(120),
  mobileNumber: mobileNumberSchema,
  email: z.string().trim().email('Enter a valid email').optional(),
  password: passwordSchema,
});

export const listRegistrationsQuerySchema = paginationQuerySchema.extend({
  status: z
    .enum([RegistrationStatus.PENDING, RegistrationStatus.APPROVED, RegistrationStatus.REJECTED])
    .optional(),
});

export const registrationIdParamSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id'),
});

export const rejectRegistrationSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export type CreateRegistrationInput = z.infer<typeof createRegistrationSchema>;
export type ListRegistrationsQuery = z.infer<typeof listRegistrationsQuerySchema>;
