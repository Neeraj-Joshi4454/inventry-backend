import { z } from 'zod';
import { ExpensePaymentMethod, ExpenseStatus } from '../../types/enums';
import { paginationQuerySchema } from '../../utils/pagination';

export const createExpenseSchema = z.object({
  title: z.string().min(1, 'Expense title is required'),
  categoryId: z.string().min(1, 'Expense category is required'),
  amount: z.number().positive('Amount must be greater than zero'),
  expenseDate: z.coerce.date({ message: 'A valid expense date is required' }),
  paymentMethod: z.enum(Object.values(ExpensePaymentMethod) as [string, ...string[]]),
  referenceNumber: z.string().optional(),
  notes: z.string().optional(),
  attachmentUrl: z.string().optional(),
});

export const updateExpenseSchema = createExpenseSchema.partial();

export const setExpenseStatusSchema = z.object({
  status: z.enum(Object.values(ExpenseStatus) as [string, ...string[]]),
});

export const listExpensesQuerySchema = paginationQuerySchema.extend({
  search: z.string().optional(),
  categoryId: z.string().optional(),
  paymentMethod: z.enum(Object.values(ExpensePaymentMethod) as [string, ...string[]]).optional(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
  status: z.enum(['active', 'cancelled', 'all']).optional(),
});

export const expenseIdParamSchema = z.object({
  id: z.string().min(1),
});

export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;
export type SetExpenseStatusInput = z.infer<typeof setExpenseStatusSchema>;
export type ListExpensesQuery = z.infer<typeof listExpensesQuerySchema>;
