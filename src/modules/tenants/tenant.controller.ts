import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendPaginated, sendSuccess } from '../../utils/apiResponse';
import { getPaginationParams } from '../../utils/pagination';
import * as tenantService from './tenant.service';
import type { CreateTenantInput, ListTenantsQuery, UpdateTenantInput } from './tenant.validators';

export const createTenantHandler = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as CreateTenantInput;
  const result = await tenantService.createTenantWithOwner(
    { superAdminId: req.user!.userId, ipAddress: req.ip },
    input
  );
  sendSuccess(res, 201, 'Tenant created successfully', result);
});

export const listTenantsHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as ListTenantsQuery;
  const pagination = getPaginationParams(query);
  const { tenants, meta } = await tenantService.listTenants(pagination, query);
  sendPaginated(res, 200, 'Tenants fetched successfully', tenants, meta);
});

export const updateTenantStatusHandler = asyncHandler(async (req: Request, res: Response) => {
  const { status } = req.body as { status: Parameters<typeof tenantService.updateTenantStatus>[1] };
  const tenant = await tenantService.updateTenantStatus(req.params.tenantId as string, status);
  sendSuccess(res, 200, 'Tenant status updated successfully', tenant);
});

export const updateTenantHandler = asyncHandler(async (req: Request, res: Response) => {
  const tenant = await tenantService.updateTenant(
    req.params.tenantId as string,
    req.body as UpdateTenantInput
  );
  sendSuccess(res, 200, 'Tenant updated successfully', tenant);
});
