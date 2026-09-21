import { z } from 'zod';

/**
 * Canonical storage format (v1): a bare 10-digit Indian national mobile
 * number, no country code, no separators — e.g. "9876543210". Chosen so
 * "9876543210" and "+919876543210" and "919876543210" all normalize to the
 * exact same stored value, preventing accidental duplicate accounts from
 * formatting differences.
 *
 * This is an intentional India-only v1 constraint, not a structural limit:
 * when international numbers are needed, the natural migration is to store
 * E.164 (e.g. "+919876543210") plus a separate `countryCode` field rather
 * than changing this function's contract — normalizeMobileNumber() would
 * become "normalize to E.164" and the 10-digit assumption below would move
 * into an India-specific validator. No other part of the codebase assumes
 * the 10-digit shape except this file and mobileNumberSchema below.
 */
export function normalizeMobileNumber(raw: string): string {
  const digitsOnly = raw.replace(/\D/g, '');

  if (digitsOnly.length === 12 && digitsOnly.startsWith('91')) {
    return digitsOnly.slice(2);
  }
  if (digitsOnly.length === 11 && digitsOnly.startsWith('0')) {
    return digitsOnly.slice(1);
  }
  return digitsOnly;
}

const INDIAN_MOBILE_PATTERN = /^[6-9]\d{9}$/;

/** Zod schema: accepts any reasonable input format, stores the canonical 10-digit form. */
export const mobileNumberSchema = z
  .string()
  .transform((val) => normalizeMobileNumber(val))
  .refine((val) => INDIAN_MOBILE_PATTERN.test(val), {
    message: 'Enter a valid 10-digit mobile number',
  });
