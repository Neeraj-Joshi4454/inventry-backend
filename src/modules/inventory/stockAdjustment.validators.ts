import { z } from 'zod';

export const stockAdjustmentSchema = z.object({
  productId: z.string().min(1),
  type: z.enum(['IN', 'OUT']),
  quantity: z.number().positive('Adjustment quantity must be greater than zero'),
  reason: z.string().min(1, 'A reason is required'),
  notes: z.string().optional(),
});

export type StockAdjustmentInput = z.infer<typeof stockAdjustmentSchema>;
