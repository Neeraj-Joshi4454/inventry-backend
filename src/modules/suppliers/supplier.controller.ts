import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendPaginated, sendSuccess } from '../../utils/apiResponse';
import { getPaginationParams } from '../../utils/pagination';
import {
  createSupplier,
  getSupplierById,
  getSupplierPurchaseHistory,
  listSuppliers,
  setSupplierStatus,
  updateSupplier,
} from './supplier.service';
import type {
  CreateSupplierInput,
  ListSuppliersQuery,
  SetSupplierStatusInput,
  SupplierPurchaseHistoryQuery,
  UpdateSupplierInput,
} from './supplier.validators';

export const createSupplierHandler = asyncHandler(async (req: Request, res: Response) => {
  const supplier = await createSupplier({
    tenantId: req.user!.tenantId!,
    userId: req.user!.userId,
    userRole: req.user!.role,
    input: req.body as CreateSupplierInput,
    ipAddress: req.ip,
  });
  sendSuccess(res, 201, 'Supplier created successfully', supplier);
});

export const listSuppliersHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as ListSuppliersQuery;
  const pagination = getPaginationParams(query);
  const { suppliers, meta } = await listSuppliers(req.user!.tenantId!, query, pagination);
  sendPaginated(res, 200, 'Suppliers fetched successfully', suppliers, meta);
});

export const getSupplierHandler = asyncHandler(async (req: Request, res: Response) => {
  const supplier = await getSupplierById(req.user!.tenantId!, req.params.id as string);
  sendSuccess(res, 200, 'Supplier fetched successfully', supplier);
});

export const updateSupplierHandler = asyncHandler(async (req: Request, res: Response) => {
  const supplier = await updateSupplier({
    tenantId: req.user!.tenantId!,
    userId: req.user!.userId,
    userRole: req.user!.role,
    supplierId: req.params.id as string,
    input: req.body as UpdateSupplierInput,
    ipAddress: req.ip,
  });
  sendSuccess(res, 200, 'Supplier updated successfully', supplier);
});

export const setSupplierStatusHandler = asyncHandler(async (req: Request, res: Response) => {
  const supplier = await setSupplierStatus({
    tenantId: req.user!.tenantId!,
    userId: req.user!.userId,
    userRole: req.user!.role,
    supplierId: req.params.id as string,
    input: req.body as SetSupplierStatusInput,
    ipAddress: req.ip,
  });
  sendSuccess(res, 200, 'Supplier status updated successfully', supplier);
});

export const getSupplierPurchaseHistoryHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const query = req.query as unknown as SupplierPurchaseHistoryQuery;
    const pagination = getPaginationParams(query);
    const result = await getSupplierPurchaseHistory(
      req.user!.tenantId!,
      req.params.id as string,
      query,
      pagination
    );
    sendSuccess(res, 200, 'Supplier purchase history fetched successfully', result);
  }
);
