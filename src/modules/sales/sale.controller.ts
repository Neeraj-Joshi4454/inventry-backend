import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendPaginated, sendSuccess } from '../../utils/apiResponse';
import { getPaginationParams } from '../../utils/pagination';
import { createSale, getSaleById, getSaleInvoiceData, listSales } from './sale.service';
import { createSaleReturn, listSaleReturns } from './saleReturn.service';
import type { CreateSaleInput, CreateSaleReturnInput, ListSalesQuery } from './sale.validators';

// requireTenantContext + validate() have already run by the time this
// handler executes (see sale.routes.ts) — req.user.tenantId and req.body
// are guaranteed present and well-formed here.
export const createSaleHandler = asyncHandler(async (req: Request, res: Response) => {
  const sale = await createSale({
    tenantId: req.user!.tenantId!,
    userId: req.user!.userId,
    userRole: req.user!.role,
    input: req.body as CreateSaleInput,
    ipAddress: req.ip,
  });

  sendSuccess(res, 201, 'Sale created successfully', sale);
});

export const listSalesHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as ListSalesQuery;
  const pagination = getPaginationParams(query);
  const { sales, meta } = await listSales(req.user!.tenantId!, query, pagination);
  sendPaginated(res, 200, 'Sales fetched successfully', sales, meta);
});

export const getSaleHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await getSaleById(req.user!.tenantId!, req.params.id as string);
  sendSuccess(res, 200, 'Sale fetched successfully', result);
});

export const getSaleInvoiceHandler = asyncHandler(async (req: Request, res: Response) => {
  const invoice = await getSaleInvoiceData(req.user!.tenantId!, req.params.id as string);
  sendSuccess(res, 200, 'Sale invoice data fetched successfully', invoice);
});

export const createSaleReturnHandler = asyncHandler(async (req: Request, res: Response) => {
  const saleReturn = await createSaleReturn({
    tenantId: req.user!.tenantId!,
    userId: req.user!.userId,
    userRole: req.user!.role,
    saleId: req.params.id as string,
    input: req.body as CreateSaleReturnInput,
    ipAddress: req.ip,
  });
  sendSuccess(res, 201, 'Sale return recorded successfully', saleReturn);
});

export const listSaleReturnsHandler = asyncHandler(async (req: Request, res: Response) => {
  const pagination = getPaginationParams(req.query as unknown as { page: number; limit: number });
  const { returns, meta } = await listSaleReturns(
    req.user!.tenantId!,
    req.params.id as string,
    pagination
  );
  sendPaginated(res, 200, 'Sale returns fetched successfully', returns, meta);
});
