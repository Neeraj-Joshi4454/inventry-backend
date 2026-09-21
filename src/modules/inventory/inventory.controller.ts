import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendPaginated, sendSuccess } from '../../utils/apiResponse';
import { getPaginationParams } from '../../utils/pagination';
import { createOpeningStock } from './openingStock.service';
import { createStockAdjustment } from './stockAdjustment.service';
import {
  getInventoryByProduct,
  listInventory,
  listInventoryTransactions,
} from './inventory.query.service';
import type {
  ListInventoryQuery,
  ListTransactionsQuery,
  OpeningStockInput,
} from './inventory.validators';
import type { StockAdjustmentInput } from './stockAdjustment.validators';

export const createOpeningStockHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await createOpeningStock({
    tenantId: req.user!.tenantId!,
    userId: req.user!.userId,
    userRole: req.user!.role,
    input: req.body as OpeningStockInput,
    ipAddress: req.ip,
  });
  sendSuccess(res, 201, 'Opening stock recorded successfully', result);
});

export const createStockAdjustmentHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await createStockAdjustment({
    tenantId: req.user!.tenantId!,
    userId: req.user!.userId,
    userRole: req.user!.role,
    input: req.body as StockAdjustmentInput,
    ipAddress: req.ip,
  });
  sendSuccess(res, 201, 'Stock adjustment recorded successfully', result);
});

export const listInventoryHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as ListInventoryQuery;
  const pagination = getPaginationParams(query);
  const { items, meta } = await listInventory(req.user!.tenantId!, query, pagination);
  sendPaginated(res, 200, 'Inventory fetched successfully', items, meta);
});

export const getInventoryHandler = asyncHandler(async (req: Request, res: Response) => {
  const inventory = await getInventoryByProduct(
    req.user!.tenantId!,
    req.params.productId as string
  );
  sendSuccess(res, 200, 'Inventory fetched successfully', inventory);
});

// Not a plain sendPaginated response: the ledger view also needs to know
// which product it's for (name/SKU for the screen header), so the payload
// is { product, transactions, meta } rather than a bare paginated array.
export const listInventoryTransactionsHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const query = req.query as unknown as ListTransactionsQuery;
    const pagination = getPaginationParams(query);
    const result = await listInventoryTransactions(
      req.user!.tenantId!,
      req.params.productId as string,
      query,
      pagination
    );
    sendSuccess(res, 200, 'Inventory transactions fetched successfully', result);
  }
);
