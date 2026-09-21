import { z } from 'zod';

export const createExpenseCategorySchema = z.object({
  name: z.string().min(1, 'Category name is required'),
  description: z.string().optional(),
});

export const updateExpenseCategorySchema = createExpenseCategorySchema.partial();

export const setExpenseCategoryStatusSchema = z.object({
  isActive: z.boolean(),
});

export const listExpenseCategoriesQuerySchema = z.object({
  status: z.enum(['active', 'inactive', 'all']).optional(),
});

export const expenseCategoryIdParamSchema = z.object({
  id: z.string().min(1),
});

export type CreateExpenseCategoryInput = z.infer<typeof createExpenseCategorySchema>;
export type UpdateExpenseCategoryInput = z.infer<typeof updateExpenseCategorySchema>;
export type SetExpenseCategoryStatusInput = z.infer<typeof setExpenseCategoryStatusSchema>;
export type ListExpenseCategoriesQuery = z.infer<typeof listExpenseCategoriesQuerySchema>;
