import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendPaginated, sendSuccess } from '../../utils/apiResponse';
import { getPaginationParams, type PaginationQuery } from '../../utils/pagination';
import {
  createPurchase,
  getPurchaseById,
  getPurchaseInvoiceData,
  listPurchases,
} from './purchase.service';
import { createPurchaseReturn, listPurchaseReturns } from './purchaseReturn.service';
import type {
  CreatePurchaseInput,
  CreatePurchaseReturnInput,
  ListPurchasesQuery,
} from './purchase.validators';

export const createPurchaseHandler = asyncHandler(async (req: Request, res: Response) => {
  const purchase = await createPurchase({
    tenantId: req.user!.tenantId!,
    userId: req.user!.userId,
    userRole: req.user!.role,
    input: req.body as CreatePurchaseInput,
    ipAddress: req.ip,
  });
  sendSuccess(res, 201, 'Purchase created successfully', purchase);
});

export const listPurchasesHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as ListPurchasesQuery;
  const pagination = getPaginationParams(query);
  const { purchases, meta } = await listPurchases(req.user!.tenantId!, query, pagination);
  sendPaginated(res, 200, 'Purchases fetched successfully', purchases, meta);
});

export const getPurchaseHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await getPurchaseById(req.user!.tenantId!, req.params.id as string);
  sendSuccess(res, 200, 'Purchase fetched successfully', result);
});

export const getPurchaseInvoiceHandler = asyncHandler(async (req: Request, res: Response) => {
  const invoice = await getPurchaseInvoiceData(req.user!.tenantId!, req.params.id as string);
  sendSuccess(res, 200, 'Purchase invoice data fetched successfully', invoice);
});

export const createPurchaseReturnHandler = asyncHandler(async (req: Request, res: Response) => {
  const purchaseReturn = await createPurchaseReturn({
    tenantId: req.user!.tenantId!,
    userId: req.user!.userId,
    userRole: req.user!.role,
    purchaseId: req.params.id as string,
    input: req.body as CreatePurchaseReturnInput,
    ipAddress: req.ip,
  });
  sendSuccess(res, 201, 'Purchase return recorded successfully', purchaseReturn);
});

export const listPurchaseReturnsHandler = asyncHandler(async (req: Request, res: Response) => {
  const pagination = getPaginationParams(req.query as unknown as PaginationQuery);
  const { returns, meta } = await listPurchaseReturns(
    req.user!.tenantId!,
    req.params.id as string,
    pagination
  );
  sendPaginated(res, 200, 'Purchase returns fetched successfully', returns, meta);
});
