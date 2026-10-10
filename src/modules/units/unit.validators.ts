import { z } from 'zod';

export const createUnitSchema = z.object({
  name: z.string().min(1, 'Unit name is required'),
  symbol: z.string().min(1, 'Unit symbol is required'),
});

export const unitIdParamSchema = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid unit id'),
});

export type CreateUnitInput = z.infer<typeof createUnitSchema>;
