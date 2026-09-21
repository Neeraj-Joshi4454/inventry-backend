import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendPaginated, sendSuccess } from '../../utils/apiResponse';
import { getPaginationParams } from '../../utils/pagination';
import { getCustomerPaymentById, listCustomerPayments, recordCustomerPayment } from './customerPayment.service';
import type { ListCustomerPaymentsQuery, RecordCustomerPaymentInput } from './customerPayment.validators';

export const recordCustomerPaymentHandler = asyncHandler(async (req: Request, res: Response) => {
  const payment = await recordCustomerPayment({
    tenantId: req.user!.tenantId!,
    userId: req.user!.userId,
    userRole: req.user!.role,
    input: req.body as RecordCustomerPaymentInput,
    ipAddress: req.ip,
  });
  sendSuccess(res, 201, 'Payment recorded successfully', payment);
});

export const listCustomerPaymentsHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as ListCustomerPaymentsQuery;
  const pagination = getPaginationParams(query);
  const { payments, meta } = await listCustomerPayments(req.user!.tenantId!, query, pagination);
  sendPaginated(res, 200, 'Payments fetched successfully', payments, meta);
});

export const getCustomerPaymentHandler = asyncHandler(async (req: Request, res: Response) => {
  const payment = await getCustomerPaymentById(req.user!.tenantId!, req.params.id as string);
  sendSuccess(res, 200, 'Payment fetched successfully', payment);
});
