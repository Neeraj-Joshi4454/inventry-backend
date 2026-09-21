import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  exportCustomersCsv,
  exportInventoryCsv,
  exportPurchasesCsv,
  exportSalesCsv,
  exportSuppliersCsv,
} from './export.service';
import type { ListSalesQuery } from '../sales/sale.validators';
import type { ListPurchasesQuery } from '../purchases/purchase.validators';
import type { ListInventoryQuery } from '../inventory/inventory.validators';
import type { ListCustomersQuery } from '../customers/customer.validators';
import type { ListSuppliersQuery } from '../suppliers/supplier.validators';

function sendCsv(res: Response, filename: string, csv: string) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.status(200).send(csv);
}

// Each handler's query has already been validated/coerced by the same
// schema its equivalent list endpoint uses (see export.routes.ts) —
// fromDate/toDate arrive as real Date objects, ids are well-formed, etc.
export const exportSalesCsvHandler = asyncHandler(async (req: Request, res: Response) => {
  const csv = await exportSalesCsv(req.user!.tenantId!, req.query as unknown as ListSalesQuery);
  sendCsv(res, 'sales.csv', csv);
});

export const exportPurchasesCsvHandler = asyncHandler(async (req: Request, res: Response) => {
  const csv = await exportPurchasesCsv(
    req.user!.tenantId!,
    req.query as unknown as ListPurchasesQuery
  );
  sendCsv(res, 'purchases.csv', csv);
});

export const exportInventoryCsvHandler = asyncHandler(async (req: Request, res: Response) => {
  const csv = await exportInventoryCsv(
    req.user!.tenantId!,
    req.query as unknown as ListInventoryQuery
  );
  sendCsv(res, 'inventory.csv', csv);
});

export const exportCustomersCsvHandler = asyncHandler(async (req: Request, res: Response) => {
  const csv = await exportCustomersCsv(
    req.user!.tenantId!,
    req.query as unknown as ListCustomersQuery
  );
  sendCsv(res, 'customers.csv', csv);
});

export const exportSuppliersCsvHandler = asyncHandler(async (req: Request, res: Response) => {
  const csv = await exportSuppliersCsv(
    req.user!.tenantId!,
    req.query as unknown as ListSuppliersQuery
  );
  sendCsv(res, 'suppliers.csv', csv);
});
