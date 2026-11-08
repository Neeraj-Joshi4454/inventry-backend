import { z } from 'zod';

// URL names match the mobile app's local storage folders.
export const BRANDING_IMAGE_KINDS = {
  upi_qr: 'upiQr',
  business_logo: 'businessLogo',
} as const;
export type BrandingImageKind = keyof typeof BRANDING_IMAGE_KINDS;

export const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

export const brandingImageParamSchema = z.object({
  kind: z.enum(Object.keys(BRANDING_IMAGE_KINDS) as [BrandingImageKind, ...BrandingImageKind[]]),
});

export const bankDetailsSchema = z.object({
  accountHolderName: z.string().trim().min(1).max(100),
  bankName: z.string().trim().min(1).max(100),
  accountNumber: z
    .string()
    .trim()
    .regex(/^[0-9]{6,18}$/, 'Account number must be 6–18 digits'),
  ifsc: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid IFSC code'),
  branch: z.string().trim().max(100).optional(),
});

export type BankDetailsInput = z.infer<typeof bankDetailsSchema>;
