import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendPaginated, sendSuccess } from '../../utils/apiResponse';
import { getPaginationParams } from '../../utils/pagination';
import * as adminService from './admin.service';
import type {
  AdminReportQuery,
  ListAdminDocumentsQuery,
  ListAdminInventoryQuery,
  ListAdminProductsQuery,
} from './admin.validators';

export const getOverviewHandler = asyncHandler(async (_req: Request, res: Response) => {
  sendSuccess(res, 200, 'Overview fetched successfully', await adminService.getOverview());
});

export const getTenantStatsHandler = asyncHandler(async (req: Request, res: Response) => {
  const stats = await adminService.getTenantStats(req.params.tenantId as string);
  sendSuccess(res, 200, 'Business statistics fetched successfully', stats);
});

export const listProductsHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as ListAdminProductsQuery;
  const { items, meta } = await adminService.listProducts(query, getPaginationParams(query));
  sendPaginated(res, 200, 'Products fetched successfully', items, meta);
});

export const listInventoryHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as ListAdminInventoryQuery;
  const { items, meta } = await adminService.listInventory(query, getPaginationParams(query));
  sendPaginated(res, 200, 'Inventory fetched successfully', items, meta);
});

export const listSalesHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as ListAdminDocumentsQuery;
  const { items, meta } = await adminService.listSales(query, getPaginationParams(query));
  sendPaginated(res, 200, 'Sales fetched successfully', items, meta);
});

export const listPurchasesHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as ListAdminDocumentsQuery;
  const { items, meta } = await adminService.listPurchases(query, getPaginationParams(query));
  sendPaginated(res, 200, 'Purchases fetched successfully', items, meta);
});

export const getReportHandler = asyncHandler(async (req: Request, res: Response) => {
  const report = await adminService.getReport(req.query as unknown as AdminReportQuery);
  sendSuccess(res, 200, 'Report fetched successfully', report);
});
