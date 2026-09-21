import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendSuccess } from '../../utils/apiResponse';
import { createCategory, listCategories } from './category.service';
import type { CreateCategoryInput } from './category.validators';

export const listCategoriesHandler = asyncHandler(async (req: Request, res: Response) => {
  const categories = await listCategories(req.user!.tenantId!);
  sendSuccess(res, 200, 'Categories fetched successfully', categories);
});

export const createCategoryHandler = asyncHandler(async (req: Request, res: Response) => {
  const category = await createCategory({
    tenantId: req.user!.tenantId!,
    userId: req.user!.userId,
    userRole: req.user!.role,
    input: req.body as CreateCategoryInput,
    ipAddress: req.ip,
  });
  sendSuccess(res, 201, 'Category created successfully', category);
});
