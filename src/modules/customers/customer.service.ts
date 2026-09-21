import { Types } from 'mongoose';
import { Customer } from '../../models/party.model';
import { Sale } from '../../models/sale.model';
import { CustomerPayment } from '../../models/customerPayment.model';
import { PaymentStatus } from '../../types/enums';
import { AuditAction } from '../../constants/auditActions';
import { NotFoundError } from '../../utils/errors';
import { buildSearchFilter } from '../../utils/queryFilters';
import { convertDecimals } from '../../utils/schemaJson';
import { buildPaginationMeta, type PaginationParams } from '../../utils/pagination';
import { recordAuditLog } from '../auditLogs/auditLog.service';
import type { UserRole } from '../../types/enums';
import type {
  CreateCustomerInput,
  CustomerSalesHistoryQuery,
  ListCustomersQuery,
  SetCustomerStatusInput,
  UpdateCustomerInput,
} from './customer.validators';

export async function createCustomer(params: {
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  userRole: UserRole;
  input: CreateCustomerInput;
  ipAddress?: string;
}) {
  const { tenantId, userId, userRole, input, ipAddress } = params;
  const customer = await Customer.create({ tenantId, ...input });

  await recordAuditLog({
    tenantId,
    actorId: userId,
    actorRole: userRole,
    action: AuditAction.CUSTOMER_CREATED,
    entityType: 'Customer',
    entityId: customer._id,
    changes: { after: { name: customer.name } },
    ipAddress,
  });

  return customer;
}

export async function listCustomers(
  tenantId: Types.ObjectId,
  query: Partial<ListCustomersQuery>,
  pagination: PaginationParams
) {
  const filter: Record<string, unknown> = { tenantId };
  if (query.search?.trim()) {
    Object.assign(filter, buildSearchFilter('name', query.search.trim()));
  }

  const [customers, total] = await Promise.all([
    Customer.find(filter).sort({ name: 1 }).skip(pagination.skip).limit(pagination.limit),
    Customer.countDocuments(filter),
  ]);

  return { customers, meta: buildPaginationMeta(total, pagination.page, pagination.limit) };
}

export async function getCustomerById(tenantId: Types.ObjectId, customerId: string) {
  const customer = await Customer.findOne({ _id: customerId, tenantId });
  if (!customer) {
    throw new NotFoundError('Customer not found');
  }
  return customer;
}

export async function updateCustomer(params: {
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  userRole: UserRole;
  customerId: string;
  input: UpdateCustomerInput;
  ipAddress?: string;
}) {
  const { tenantId, userId, userRole, customerId, input, ipAddress } = params;

  const customer = await Customer.findOne({ _id: customerId, tenantId });
  if (!customer) {
    throw new NotFoundError('Customer not found');
  }

  Object.assign(customer, input);
  await customer.save();

  await recordAuditLog({
    tenantId,
    actorId: userId,
    actorRole: userRole,
    action: AuditAction.CUSTOMER_UPDATED,
    entityType: 'Customer',
    entityId: customer._id,
    changes: { after: input },
    ipAddress,
  });

  return customer;
}

export async function setCustomerStatus(params: {
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  userRole: UserRole;
  customerId: string;
  input: SetCustomerStatusInput;
  ipAddress?: string;
}) {
  const { tenantId, userId, userRole, customerId, input, ipAddress } = params;

  const customer = await Customer.findOne({ _id: customerId, tenantId });
  if (!customer) {
    throw new NotFoundError('Customer not found');
  }

  customer.isActive = input.isActive;
  await customer.save();

  await recordAuditLog({
    tenantId,
    actorId: userId,
    actorRole: userRole,
    action: AuditAction.CUSTOMER_STATUS_CHANGED,
    entityType: 'Customer',
    entityId: customer._id,
    changes: { after: { isActive: input.isActive } },
    ipAddress,
  });

  return customer;
}

/**
 * Sales history + outstanding summary for one customer — total sold,
 * total paid, total still owed (sum of Sale.dueAmount), last sale/payment
 * dates, and how many invoices are still unpaid or partially paid.
 * Computed from the real Sale/CustomerPayment data rather than any
 * separately-tracked running balance — mirrors
 * supplier.service.ts::getSupplierPurchaseHistory for the customer side.
 */
export async function getCustomerSalesHistory(
  tenantId: Types.ObjectId,
  customerId: string,
  query: Partial<CustomerSalesHistoryQuery>,
  pagination: PaginationParams
) {
  const customer = await Customer.findOne({ _id: customerId, tenantId });
  if (!customer) {
    throw new NotFoundError('Customer not found');
  }

  const match: Record<string, unknown> = { tenantId, customerId: customer._id };
  if (query.fromDate || query.toDate) {
    const range: Record<string, Date> = {};
    if (query.fromDate) range.$gte = query.fromDate;
    if (query.toDate) range.$lte = query.toDate;
    match.saleDate = range;
  }

  const [summaryAgg, totalCountAgg, sales, lastPayment] = await Promise.all([
    Sale.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalSales: { $sum: 1 },
          totalAmount: { $sum: '$totalAmount' },
          totalPaid: { $sum: '$paidAmount' },
          totalOutstanding: { $sum: '$dueAmount' },
          lastSaleDate: { $max: '$saleDate' },
          unpaidOrPartialCount: {
            $sum: {
              $cond: [
                {
                  $in: [
                    '$paymentStatus',
                    [PaymentStatus.CREDIT, PaymentStatus.PARTIAL, PaymentStatus.UNPAID],
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]),
    Sale.aggregate([{ $match: match }, { $count: 'count' }]),
    Sale.find(match)
      .sort({ saleDate: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .populate('createdBy', 'name'),
    CustomerPayment.findOne({ tenantId, customerId: customer._id }).sort({ paymentDate: -1 }),
  ]);

  const summary = summaryAgg[0] ?? {
    totalSales: 0,
    totalAmount: 0,
    totalPaid: 0,
    totalOutstanding: 0,
    lastSaleDate: null,
    unpaidOrPartialCount: 0,
  };
  const total = totalCountAgg[0]?.count ?? 0;

  return {
    customer,
    summary: convertDecimals({
      totalSales: summary.totalSales,
      totalAmount: summary.totalAmount,
      totalPaid: summary.totalPaid,
      totalOutstanding: summary.totalOutstanding,
      lastSaleDate: summary.lastSaleDate,
      lastPaymentDate: lastPayment?.paymentDate ?? null,
      unpaidOrPartialCount: summary.unpaidOrPartialCount,
    }),
    sales,
    meta: buildPaginationMeta(total, pagination.page, pagination.limit),
  };
}
