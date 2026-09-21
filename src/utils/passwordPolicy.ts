import { z } from 'zod';

// Configurable, but deliberately not "complexity theatre" (no mandatory
// mixed-case/symbol/digit rules) — length plus a denylist of the most
// common weak passwords catches the overwhelming majority of real risk
// without making passwords harder for shop-floor staff to actually use.
const MIN_LENGTH = Number(process.env.PASSWORD_MIN_LENGTH ?? 8);

const COMMON_WEAK_PASSWORDS = new Set([
  'password',
  'password123',
  '12345678',
  '123456789',
  '1234567890',
  'qwertyui',
  'qwerty123',
  'admin123',
  'letmein1',
  'welcome1',
]);

export const passwordSchema = z
  .string()
  .min(1, 'Password is required')
  .min(MIN_LENGTH, `Password must be at least ${MIN_LENGTH} characters`)
  .refine((val) => !COMMON_WEAK_PASSWORDS.has(val.toLowerCase()), {
    message: 'This password is too common — choose a less predictable one',
  });
