import { z } from 'zod';
import { TaxType } from '../../types/enums';

// Standard 15-character GSTIN: 2-digit state code + 10-character PAN +
// 1-digit entity code + 'Z' by convention + 1 checksum character.
const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

// A GSTIN, once present, must be well-formed — but the field itself stays
// optional at the schema level (a business can enable GST and fill in the
// GSTIN in a later request). "GSTIN required once GST is enabled" is a
// cross-field rule checked in tax.service.ts against the merged, final
// config, not here against one partial PATCH body in isolation.
export const updateTaxConfigSchema = z.object({
  gstEnabled: z.boolean().optional(),
  gstin: z.string().trim().toUpperCase().regex(GSTIN_REGEX, 'Invalid GSTIN format').optional(),
  state: z.string().optional(),
  defaultTaxRate: z.number().min(0).max(100).optional(),
  taxType: z.enum(Object.values(TaxType) as [string, ...string[]]).optional(),
});

export type UpdateTaxConfigInput = z.infer<typeof updateTaxConfigSchema>;
