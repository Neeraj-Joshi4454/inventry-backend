import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendSuccess } from '../../utils/apiResponse';
import { createUnit, listUnits } from './unit.service';
import type { CreateUnitInput } from './unit.validators';

export const listUnitsHandler = asyncHandler(async (req: Request, res: Response) => {
  const units = await listUnits(req.user!.tenantId!);
  sendSuccess(res, 200, 'Units fetched successfully', units);
});

export const createUnitHandler = asyncHandler(async (req: Request, res: Response) => {
  const unit = await createUnit({
    tenantId: req.user!.tenantId!,
    userId: req.user!.userId,
    userRole: req.user!.role,
    input: req.body as CreateUnitInput,
    ipAddress: req.ip,
  });
  sendSuccess(res, 201, 'Unit created successfully', unit);
});
