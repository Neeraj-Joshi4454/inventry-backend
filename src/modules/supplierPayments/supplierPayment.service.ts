import { Types } from 'mongoose';
import { Purchase } from '../../models/purchase.model';
import { SupplierPayment } from '../../models/supplierPayment.model';
import { PaymentStatus } from '../../types/enums';
import { AuditAction } from '../../constants/auditActions';
import { BadRequestError, NotFoundError } from '../../utils/errors';
import { MONEY_EPSILON, roundMoney } from '../../utils/money';
import { runInTransaction } from '../../utils/withTransaction';
import { buildPaginationMeta, type PaginationParams } from '../../utils/pagination';
import { recordAuditLog } from '../auditLogs/auditLog.service';
import type { UserRole } from '../../types/enums';
import type {
  ListSupplierPaymentsQuery,
  RecordSupplierPaymentInput,
} from './supplierPayment.validators';

/**
 * Atomically records a payment made to a supplier against one purchase and
 * keeps the purchase's cached paidAmount/dueAmount/paymentStatus in sync —
 * the purchase-side twin of customerPayment.service.ts::recordCustomerPayment.
 * Inventory is never touched. supplierId is always taken from the purchase
 * itself, never from the request body.
 */
export async function recordSupplierPayment(params: {
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  userRole: UserRole;
  input: RecordSupplierPaymentInput;
  ipAddress?: string;
}) {
  const { tenantId, userId, userRole, input, ipAddress } = params;

  return runInTransaction(async (session) => {
    const purchase = await Purchase.findOne({ _id: input.purchaseId, tenantId }).session(session);
    if (!purchase) {
      throw new NotFoundError('Purchase not found');
    }

    const dueAmount = Number(purchase.dueAmount.toString());
    if (dueAmount <= MONEY_EPSILON) {
      throw new BadRequestError('This purchase is already fully paid');
    }
    if (input.amount > dueAmount + MONEY_EPSILON) {
      throw new BadRequestError(
        `Payment amount (${input.amount}) cannot exceed the outstanding amount (${dueAmount})`
      );
    }

    const [payment] = await SupplierPayment.create(
      [
        {
          tenantId,
          supplierId: purchase.supplierId,
          purchaseId: purchase._id,
          amount: input.amount,
          method: input.method,
          paymentDate: input.paymentDate ?? new Date(),
          referenceNumber: input.referenceNumber || undefined,
          notes: input.notes,
          recordedBy: userId,
        },
      ],
      { session }
    );

    const totalAmount = Number(purchase.totalAmount.toString());
    const newPaidAmount = roundMoney(Number(purchase.paidAmount.toString()) + input.amount);
    const newDueAmount = roundMoney(Math.max(totalAmount - newPaidAmount, 0));
    // Decimal128 fields need an explicit Decimal128 on direct assignment —
    // see customerPayment.service.ts.
    purchase.paidAmount = Types.Decimal128.fromString(newPaidAmount.toFixed(2));
    purchase.dueAmount = Types.Decimal128.fromString(newDueAmount.toFixed(2));
    purchase.paymentStatus =
      newDueAmount <= MONEY_EPSILON ? PaymentStatus.PAID : PaymentStatus.PARTIAL;
    await purchase.save({ session });

    await recordAuditLog({
      tenantId,
      actorId: userId,
      actorRole: userRole,
      action: AuditAction.SUPPLIER_PAYMENT_RECORDED,
      entityType: 'SupplierPayment',
      entityId: payment._id,
      changes: {
        after: { purchaseId: purchase._id, amount: input.amount, method: input.method },
      },
      ipAddress,
      session,
    });

    return payment;
  });
}

export async function listSupplierPayments(
  tenantId: Types.ObjectId,
  query: Partial<ListSupplierPaymentsQuery>,
  pagination: PaginationParams
) {
  const filter: Record<string, unknown> = { tenantId };
  if (query.supplierId) filter.supplierId = new Types.ObjectId(query.supplierId);
  if (query.purchaseId) filter.purchaseId = new Types.ObjectId(query.purchaseId);
  if (query.method) filter.method = query.method;
  if (query.fromDate || query.toDate) {
    const range: Record<string, Date> = {};
    if (query.fromDate) range.$gte = query.fromDate;
    if (query.toDate) range.$lte = query.toDate;
    filter.paymentDate = range;
  }

  const [payments, total] = await Promise.all([
    SupplierPayment.find(filter)
      .sort({ paymentDate: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .populate('supplierId', 'name')
      .populate('recordedBy', 'name'),
    SupplierPayment.countDocuments(filter),
  ]);

  return { payments, meta: buildPaginationMeta(total, pagination.page, pagination.limit) };
}

export async function getSupplierPaymentById(tenantId: Types.ObjectId, paymentId: string) {
  const payment = await SupplierPayment.findOne({ _id: paymentId, tenantId })
    .populate('supplierId', 'name')
    .populate('purchaseId', 'purchaseNumber')
    .populate('recordedBy', 'name');
  if (!payment) {
    throw new NotFoundError('Payment not found');
  }
  return payment;
}
