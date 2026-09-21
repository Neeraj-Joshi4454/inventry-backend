import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendSuccess } from '../../utils/apiResponse';
import { getTaxConfig, updateTaxConfig } from './tax.service';
import type { UpdateTaxConfigInput } from './tax.validators';

export const getTaxConfigHandler = asyncHandler(async (req: Request, res: Response) => {
  const config = await getTaxConfig(req.user!.tenantId!);
  sendSuccess(res, 200, 'Tax configuration fetched successfully', config);
});

export const updateTaxConfigHandler = asyncHandler(async (req: Request, res: Response) => {
  const config = await updateTaxConfig({
    tenantId: req.user!.tenantId!,
    userId: req.user!.userId,
    userRole: req.user!.role,
    input: req.body as UpdateTaxConfigInput,
    ipAddress: req.ip,
  });
  sendSuccess(res, 200, 'Tax configuration updated successfully', config);
});
