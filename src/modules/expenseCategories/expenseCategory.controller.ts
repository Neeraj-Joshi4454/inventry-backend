import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendSuccess } from '../../utils/apiResponse';
import {
  createExpenseCategory,
  listExpenseCategories,
  setExpenseCategoryStatus,
  updateExpenseCategory,
} from './expenseCategory.service';
import type {
  CreateExpenseCategoryInput,
  ListExpenseCategoriesQuery,
  SetExpenseCategoryStatusInput,
  UpdateExpenseCategoryInput,
} from './expenseCategory.validators';

export const listExpenseCategoriesHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as ListExpenseCategoriesQuery;
  const categories = await listExpenseCategories(req.user!.tenantId!, query);
  sendSuccess(res, 200, 'Expense categories fetched successfully', categories);
});

export const createExpenseCategoryHandler = asyncHandler(async (req: Request, res: Response) => {
  const category = await createExpenseCategory({
    tenantId: req.user!.tenantId!,
    userId: req.user!.userId,
    userRole: req.user!.role,
    input: req.body as CreateExpenseCategoryInput,
    ipAddress: req.ip,
  });
  sendSuccess(res, 201, 'Expense category created successfully', category);
});

export const updateExpenseCategoryHandler = asyncHandler(async (req: Request, res: Response) => {
  const category = await updateExpenseCategory({
    tenantId: req.user!.tenantId!,
    userId: req.user!.userId,
    userRole: req.user!.role,
    categoryId: req.params.id as string,
    input: req.body as UpdateExpenseCategoryInput,
    ipAddress: req.ip,
  });
  sendSuccess(res, 200, 'Expense category updated successfully', category);
});

export const setExpenseCategoryStatusHandler = asyncHandler(async (req: Request, res: Response) => {
  const category = await setExpenseCategoryStatus({
    tenantId: req.user!.tenantId!,
    userId: req.user!.userId,
    userRole: req.user!.role,
    categoryId: req.params.id as string,
    input: req.body as SetExpenseCategoryStatusInput,
    ipAddress: req.ip,
  });
  sendSuccess(res, 200, 'Expense category status updated successfully', category);
});
