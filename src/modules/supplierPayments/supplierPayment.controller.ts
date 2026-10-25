import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendPaginated, sendSuccess } from '../../utils/apiResponse';
import { getPaginationParams } from '../../utils/pagination';
import {
  getSupplierPaymentById,
  listSupplierPayments,
  recordSupplierPayment,
} from './supplierPayment.service';
import type {
  ListSupplierPaymentsQuery,
  RecordSupplierPaymentInput,
} from './supplierPayment.validators';

export const recordSupplierPaymentHandler = asyncHandler(async (req: Request, res: Response) => {
  const payment = await recordSupplierPayment({
    tenantId: req.user!.tenantId!,
    userId: req.user!.userId,
    userRole: req.user!.role,
    input: req.body as RecordSupplierPaymentInput,
    ipAddress: req.ip,
  });
  sendSuccess(res, 201, 'Payment recorded successfully', payment);
});

export const listSupplierPaymentsHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as ListSupplierPaymentsQuery;
  const pagination = getPaginationParams(query);
  const { payments, meta } = await listSupplierPayments(req.user!.tenantId!, query, pagination);
  sendPaginated(res, 200, 'Payments fetched successfully', payments, meta);
});

export const getSupplierPaymentHandler = asyncHandler(async (req: Request, res: Response) => {
  const payment = await getSupplierPaymentById(req.user!.tenantId!, req.params.id as string);
  sendSuccess(res, 200, 'Payment fetched successfully', payment);
});
