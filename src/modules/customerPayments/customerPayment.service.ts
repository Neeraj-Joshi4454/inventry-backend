import { Types } from 'mongoose';
import { Sale } from '../../models/sale.model';
import { CustomerPayment } from '../../models/customerPayment.model';
import { PaymentStatus } from '../../types/enums';
import { AuditAction } from '../../constants/auditActions';
import { BadRequestError, NotFoundError } from '../../utils/errors';
import { MONEY_EPSILON, roundMoney } from '../../utils/money';
import { runInTransaction } from '../../utils/withTransaction';
import { buildPaginationMeta, type PaginationParams } from '../../utils/pagination';
import { recordAuditLog } from '../auditLogs/auditLog.service';
import type { UserRole } from '../../types/enums';
import type { ListCustomerPaymentsQuery, RecordCustomerPaymentInput } from './customerPayment.validators';

/**
 * Atomically records a payment against one sale and keeps the sale's
 * cached paidAmount/dueAmount/paymentStatus in sync with it — the same
 * "ledger entry + cached running total, updated together in one
 * transaction" shape inventory.service.ts uses for stock. The Sale
 * document is never replaced or duplicated and inventory is never
 * touched — only its running payment totals move. customerId is always
 * taken from the sale itself, never from the request body, so a payment
 * can never be attributed to a customer other than the one who was
 * actually sold to.
 */
export async function recordCustomerPayment(params: {
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  userRole: UserRole;
  input: RecordCustomerPaymentInput;
  ipAddress?: string;
}) {
  const { tenantId, userId, userRole, input, ipAddress } = params;

  return runInTransaction(async (session) => {
    const sale = await Sale.findOne({ _id: input.saleId, tenantId }).session(session);
    if (!sale) {
      throw new NotFoundError('Sale not found');
    }

    const dueAmount = Number(sale.dueAmount.toString());
    if (dueAmount <= MONEY_EPSILON) {
      throw new BadRequestError('This sale is already fully paid');
    }
    if (input.amount > dueAmount + MONEY_EPSILON) {
      throw new BadRequestError(
        `Payment amount (${input.amount}) cannot exceed the outstanding amount (${dueAmount})`
      );
    }

    const [payment] = await CustomerPayment.create(
      [
        {
          tenantId,
          customerId: sale.customerId,
          saleId: sale._id,
          amount: input.amount,
          method: input.method,
          paymentDate: input.paymentDate ?? new Date(),
          notes: input.notes,
          recordedBy: userId,
        },
      ],
      { session }
    );

    const totalAmount = Number(sale.totalAmount.toString());
    const newPaidAmount = roundMoney(Number(sale.paidAmount.toString()) + input.amount);
    const newDueAmount = roundMoney(Math.max(totalAmount - newPaidAmount, 0));
    // Sale.paidAmount/dueAmount are Decimal128 — the hydrated document's
    // field type only accepts a Decimal128 on direct assignment (unlike
    // `.create()`, which casts a plain number for you), so build one
    // explicitly rather than relying on implicit coercion.
    sale.paidAmount = Types.Decimal128.fromString(newPaidAmount.toFixed(2));
    sale.dueAmount = Types.Decimal128.fromString(newDueAmount.toFixed(2));
    sale.paymentStatus = newDueAmount <= MONEY_EPSILON ? PaymentStatus.PAID : PaymentStatus.PARTIAL;
    await sale.save({ session });

    await recordAuditLog({
      tenantId,
      actorId: userId,
      actorRole: userRole,
      action: AuditAction.CUSTOMER_PAYMENT_RECORDED,
      entityType: 'CustomerPayment',
      entityId: payment._id,
      changes: { after: { saleId: sale._id, amount: input.amount, method: input.method } },
      ipAddress,
      session,
    });

    return payment;
  });
}

export async function listCustomerPayments(
  tenantId: Types.ObjectId,
  query: Partial<ListCustomerPaymentsQuery>,
  pagination: PaginationParams
) {
  const filter: Record<string, unknown> = { tenantId };
  if (query.customerId) filter.customerId = new Types.ObjectId(query.customerId);
  if (query.saleId) filter.saleId = new Types.ObjectId(query.saleId);
  if (query.method) filter.method = query.method;
  if (query.fromDate || query.toDate) {
    const range: Record<string, Date> = {};
    if (query.fromDate) range.$gte = query.fromDate;
    if (query.toDate) range.$lte = query.toDate;
    filter.paymentDate = range;
  }

  const [payments, total] = await Promise.all([
    CustomerPayment.find(filter)
      .sort({ paymentDate: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .populate('customerId', 'name')
      .populate('recordedBy', 'name'),
    CustomerPayment.countDocuments(filter),
  ]);

  return { payments, meta: buildPaginationMeta(total, pagination.page, pagination.limit) };
}

export async function getCustomerPaymentById(tenantId: Types.ObjectId, paymentId: string) {
  const payment = await CustomerPayment.findOne({ _id: paymentId, tenantId })
    .populate('customerId', 'name')
    .populate('saleId', 'saleNumber')
    .populate('recordedBy', 'name');
  if (!payment) {
    throw new NotFoundError('Payment not found');
  }
  return payment;
}
