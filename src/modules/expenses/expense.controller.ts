import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendPaginated, sendSuccess } from '../../utils/apiResponse';
import { getPaginationParams } from '../../utils/pagination';
import {
  createExpense,
  getExpenseById,
  getExpenseSummary,
  listExpenses,
  setExpenseStatus,
  updateExpense,
} from './expense.service';
import type {
  CreateExpenseInput,
  ListExpensesQuery,
  SetExpenseStatusInput,
  UpdateExpenseInput,
} from './expense.validators';

export const createExpenseHandler = asyncHandler(async (req: Request, res: Response) => {
  const expense = await createExpense({
    tenantId: req.user!.tenantId!,
    userId: req.user!.userId,
    userRole: req.user!.role,
    input: req.body as CreateExpenseInput,
    ipAddress: req.ip,
  });
  sendSuccess(res, 201, 'Expense created successfully', expense);
});

export const listExpensesHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as ListExpensesQuery;
  const pagination = getPaginationParams(query);
  const { expenses, meta } = await listExpenses(req.user!.tenantId!, query, pagination);
  sendPaginated(res, 200, 'Expenses fetched successfully', expenses, meta);
});

export const getExpenseHandler = asyncHandler(async (req: Request, res: Response) => {
  const expense = await getExpenseById(req.user!.tenantId!, req.params.id as string);
  sendSuccess(res, 200, 'Expense fetched successfully', expense);
});

export const updateExpenseHandler = asyncHandler(async (req: Request, res: Response) => {
  const expense = await updateExpense({
    tenantId: req.user!.tenantId!,
    userId: req.user!.userId,
    userRole: req.user!.role,
    expenseId: req.params.id as string,
    input: req.body as UpdateExpenseInput,
    ipAddress: req.ip,
  });
  sendSuccess(res, 200, 'Expense updated successfully', expense);
});

export const setExpenseStatusHandler = asyncHandler(async (req: Request, res: Response) => {
  const expense = await setExpenseStatus({
    tenantId: req.user!.tenantId!,
    userId: req.user!.userId,
    userRole: req.user!.role,
    expenseId: req.params.id as string,
    input: req.body as SetExpenseStatusInput,
    ipAddress: req.ip,
  });
  sendSuccess(res, 200, 'Expense status updated successfully', expense);
});

export const getExpenseSummaryHandler = asyncHandler(async (req: Request, res: Response) => {
  const summary = await getExpenseSummary(req.user!.tenantId!);
  sendSuccess(res, 200, 'Expense summary fetched successfully', summary);
});
