import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendPaginated, sendSuccess } from '../../utils/apiResponse';
import { getPaginationParams } from '../../utils/pagination';
import * as registrationService from './registration.service';
import type { CreateRegistrationInput, ListRegistrationsQuery } from './registration.validators';

export const submitRegistrationHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await registrationService.submitRegistration(
    req.body as CreateRegistrationInput,
    req.ip
  );
  sendSuccess(
    res,
    201,
    'Registration submitted. You can sign in once an admin approves it.',
    result
  );
});

export const listRegistrationsHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as ListRegistrationsQuery;
  const { items, meta } = await registrationService.listRegistrations(
    query,
    getPaginationParams(query)
  );
  sendPaginated(res, 200, 'Registration requests fetched successfully', items, meta);
});

export const pendingCountHandler = asyncHandler(async (_req: Request, res: Response) => {
  const count = await registrationService.countPendingRegistrations();
  sendSuccess(res, 200, 'Pending registration count fetched successfully', { count });
});

export const approveRegistrationHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await registrationService.approveRegistration(req.params.id as string, {
    superAdminId: req.user!.userId,
    ipAddress: req.ip,
  });
  sendSuccess(res, 200, 'Registration approved and business created', result);
});

export const rejectRegistrationHandler = asyncHandler(async (req: Request, res: Response) => {
  const request = await registrationService.rejectRegistration(
    req.params.id as string,
    { superAdminId: req.user!.userId, ipAddress: req.ip },
    (req.body as { reason?: string }).reason
  );
  sendSuccess(res, 200, 'Registration rejected', request);
});
