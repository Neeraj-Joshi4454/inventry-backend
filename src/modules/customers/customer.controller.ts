import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendPaginated, sendSuccess } from '../../utils/apiResponse';
import { getPaginationParams } from '../../utils/pagination';
import {
  createCustomer,
  getCustomerById,
  getCustomerSalesHistory,
  listCustomers,
  setCustomerStatus,
  updateCustomer,
} from './customer.service';
import type {
  CreateCustomerInput,
  CustomerSalesHistoryQuery,
  ListCustomersQuery,
  SetCustomerStatusInput,
  UpdateCustomerInput,
} from './customer.validators';

export const createCustomerHandler = asyncHandler(async (req: Request, res: Response) => {
  const customer = await createCustomer({
    tenantId: req.user!.tenantId!,
    userId: req.user!.userId,
    userRole: req.user!.role,
    input: req.body as CreateCustomerInput,
    ipAddress: req.ip,
  });
  sendSuccess(res, 201, 'Customer created successfully', customer);
});

export const listCustomersHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as ListCustomersQuery;
  const pagination = getPaginationParams(query);
  const { customers, meta } = await listCustomers(req.user!.tenantId!, query, pagination);
  sendPaginated(res, 200, 'Customers fetched successfully', customers, meta);
});

export const getCustomerHandler = asyncHandler(async (req: Request, res: Response) => {
  const customer = await getCustomerById(req.user!.tenantId!, req.params.id as string);
  sendSuccess(res, 200, 'Customer fetched successfully', customer);
});

export const updateCustomerHandler = asyncHandler(async (req: Request, res: Response) => {
  const customer = await updateCustomer({
    tenantId: req.user!.tenantId!,
    userId: req.user!.userId,
    userRole: req.user!.role,
    customerId: req.params.id as string,
    input: req.body as UpdateCustomerInput,
    ipAddress: req.ip,
  });
  sendSuccess(res, 200, 'Customer updated successfully', customer);
});

export const setCustomerStatusHandler = asyncHandler(async (req: Request, res: Response) => {
  const customer = await setCustomerStatus({
    tenantId: req.user!.tenantId!,
    userId: req.user!.userId,
    userRole: req.user!.role,
    customerId: req.params.id as string,
    input: req.body as SetCustomerStatusInput,
    ipAddress: req.ip,
  });
  sendSuccess(res, 200, 'Customer status updated successfully', customer);
});

export const getCustomerSalesHistoryHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as CustomerSalesHistoryQuery;
  const pagination = getPaginationParams(query);
  const result = await getCustomerSalesHistory(
    req.user!.tenantId!,
    req.params.id as string,
    query,
    pagination
  );
  sendSuccess(res, 200, 'Customer sales history fetched successfully', result);
});
