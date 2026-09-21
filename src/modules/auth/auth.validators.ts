import { z } from 'zod';
import { mobileNumberSchema } from '../../utils/mobileNumber';
import { passwordSchema } from '../../utils/passwordPolicy';

export const loginSchema = z.object({
  mobileNumber: mobileNumberSchema,
  // Login itself doesn't enforce the full password *policy* (a legacy/
  // admin-set password might predate a policy change) — it just requires
  // a non-empty string; hashing/comparison does the real check.
  password: z.string().min(1, 'Password is required'),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'refreshToken is required'),
});

export const logoutSchema = z.object({
  refreshToken: z.string().min(1, 'refreshToken is required'),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: passwordSchema,
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type LogoutInput = z.infer<typeof logoutSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
