import { z } from 'zod';

export const createUnitSchema = z.object({
  name: z.string().min(1, 'Unit name is required'),
  symbol: z.string().min(1, 'Unit symbol is required'),
});

export type CreateUnitInput = z.infer<typeof createUnitSchema>;
