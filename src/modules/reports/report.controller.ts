import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendSuccess } from '../../utils/apiResponse';
import { getPaginationParams } from '../../utils/pagination';
import {
  getDashboardSummary,
  getExpenseReport,
  getInventoryLedgerReport,
  getOutstandingCustomersReport,
  getProfitSummary,
  getPurchaseReport,
  getSalesReport,
  getStockReport,
} from './report.service';
import type {
  ExpenseReportQuery,
  InventoryLedgerReportQuery,
  OutstandingCustomersReportQuery,
  ProfitReportQuery,
  PurchaseReportQuery,
  SalesReportQuery,
  StockReportQuery,
} from './report.validators';

export const getDashboardSummaryHandler = asyncHandler(async (req: Request, res: Response) => {
  const summary = await getDashboardSummary(req.user!.tenantId!);
  sendSuccess(res, 200, 'Dashboard summary fetched successfully', summary);
});

export const getSalesReportHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as SalesReportQuery;
  const pagination = getPaginationParams(query);
  const result = await getSalesReport(req.user!.tenantId!, query, pagination);
  sendSuccess(res, 200, 'Sales report fetched successfully', result);
});

export const getPurchaseReportHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as PurchaseReportQuery;
  const pagination = getPaginationParams(query);
  const result = await getPurchaseReport(req.user!.tenantId!, query, pagination);
  sendSuccess(res, 200, 'Purchase report fetched successfully', result);
});

export const getStockReportHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as StockReportQuery;
  const pagination = getPaginationParams(query);
  const result = await getStockReport(req.user!.tenantId!, query, pagination);
  sendSuccess(res, 200, 'Stock report fetched successfully', result);
});

export const getInventoryLedgerReportHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as InventoryLedgerReportQuery;
  const pagination = getPaginationParams(query);
  const result = await getInventoryLedgerReport(req.user!.tenantId!, query, pagination);
  sendSuccess(res, 200, 'Inventory ledger report fetched successfully', result);
});

export const getProfitSummaryHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as ProfitReportQuery;
  const result = await getProfitSummary(req.user!.tenantId!, query);
  sendSuccess(res, 200, 'Profit summary fetched successfully', result);
});

export const getOutstandingCustomersReportHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as OutstandingCustomersReportQuery;
  const pagination = getPaginationParams(query);
  const result = await getOutstandingCustomersReport(req.user!.tenantId!, query, pagination);
  sendSuccess(res, 200, 'Outstanding customers report fetched successfully', result);
});

export const getExpenseReportHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as ExpenseReportQuery;
  const pagination = getPaginationParams(query);
  const result = await getExpenseReport(req.user!.tenantId!, query, pagination);
  sendSuccess(res, 200, 'Expense report fetched successfully', result);
});
