import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendSuccess } from '../../utils/apiResponse';
import { getBusinessSettings, updateBusinessSettings } from './businessSettings.service';
import type { UpdateTenantInput } from '../tenants/tenant.validators';

export const getBusinessSettingsHandler = asyncHandler(async (req: Request, res: Response) => {
  const settings = await getBusinessSettings(req.user!.tenantId!);
  sendSuccess(res, 200, 'Business settings fetched successfully', settings);
});

export const updateBusinessSettingsHandler = asyncHandler(async (req: Request, res: Response) => {
  const settings = await updateBusinessSettings(req.user!.tenantId!, req.body as UpdateTenantInput);
  sendSuccess(res, 200, 'Business settings updated successfully', settings);
});
