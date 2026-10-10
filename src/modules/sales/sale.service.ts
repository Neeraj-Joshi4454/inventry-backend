import { Types } from 'mongoose';
import { Sale, SaleItem } from '../../models/sale.model';
import { Product } from '../../models/product.model';
import { Customer } from '../../models/party.model';
import { CustomerPayment } from '../../models/customerPayment.model';
import { Tenant } from '../../models/tenant.model';
import { applyStockChange } from '../inventory/inventory.service';
import { getEffectiveTaxConfig } from '../taxes/tax.service';
import { calculateDocumentTax, resolveTaxSplit } from '../taxes/taxCalculation.service';
import {
  InventoryTransactionType,
  PaymentMethod,
  PaymentStatus,
  ReferenceType,
} from '../../types/enums';
import { AuditAction } from '../../constants/auditActions';
import { BadRequestError, NotFoundError } from '../../utils/errors';
import { escapeRegex } from '../../utils/queryFilters';
import { MONEY_EPSILON, roundMoney } from '../../utils/money';
import { runInTransaction } from '../../utils/withTransaction';
import { buildPaginationMeta, type PaginationParams } from '../../utils/pagination';
import { recordAuditLog } from '../auditLogs/auditLog.service';
import type { UserRole } from '../../types/enums';
import type { CreateSaleInput, ListSalesQuery } from './sale.validators';

async function nextSaleNumber(tenantId: Types.ObjectId): Promise<string> {
  // Simple per-tenant sequential number. Under concurrent creates this can
  // collide; the sale document's unique { tenantId, saleNumber } index turns
  // a collision into a 409 (surfaced by the generic DUPLICATE_KEY error
  // handler) rather than silent data corruption. A dedicated counters
  // collection with $inc is the natural upgrade if collision volume matters.
  const count = await Sale.countDocuments({ tenantId });
  return `SL-${String(count + 1).padStart(6, '0')}`;
}

/**
 * Atomically: validates the customer and every line item's product
 * (existence, tenant ownership, active status) up front, creates the
 * Sale + SaleItems, and decreases stock per line item via
 * inventory.service.ts::applyStockChange (SALE type — an atomic
 * guarded decrement that can never take currentStock below zero, and is
 * itself the mechanism that keeps two concurrent sales of the same
 * product from both succeeding when only one has enough stock). All of it
 * commits or rolls back together — insufficient stock on line 2 of a
 * 3-item sale leaves zero trace, not a partially-created sale with only
 * some items stocked out.
 */
export async function createSale(params: {
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  userRole: UserRole;
  input: CreateSaleInput;
  ipAddress?: string;
}) {
  const { tenantId, userId, userRole, input, ipAddress } = params;

  return runInTransaction(async (session) => {
    const customer = await Customer.findOne({ _id: input.customerId, tenantId }).session(session);
    if (!customer) {
      throw new NotFoundError('Customer not found');
    }
    if (!customer.isActive) {
      throw new BadRequestError('Cannot sell to an inactive customer');
    }

    const productIds = input.items.map((item) => new Types.ObjectId(item.productId));
    const products = await Product.find({ _id: { $in: productIds }, tenantId }).session(session);
    const productById = new Map(products.map((p) => [p._id.toString(), p]));

    for (const item of input.items) {
      const product = productById.get(item.productId);
      if (!product) {
        throw new NotFoundError(`Product ${item.productId} not found`);
      }
      if (!product.isActive) {
        throw new BadRequestError(`Product "${product.name}" is inactive`);
      }
    }

    // Tax is always computed on the backend from the tenant's own
    // configured GST regime and each product's own tax settings — a
    // client-supplied taxRate per line is only ever an explicit override,
    // never trusted as-is for the document totals (see
    // taxCalculation.service.ts, the single place this math happens).
    const taxConfig = await getEffectiveTaxConfig(tenantId);
    const customerState = customer.address?.state;
    const taxSplit = resolveTaxSplit(taxConfig, customerState);

    const taxResult = calculateDocumentTax(
      input.items.map((item) => {
        const product = productById.get(item.productId)!;
        return {
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          taxRate: item.taxRate ?? product.taxRate ?? 0,
          isPriceInclusive: item.isPriceInclusive ?? product.isPriceInclusive ?? false,
        };
      }),
      input.discountAmount,
      taxSplit
    );

    const paidAmount = roundMoney(input.paidAmount ?? 0);
    if (paidAmount > taxResult.totalAmount + MONEY_EPSILON) {
      throw new BadRequestError('Paid amount cannot exceed the sale total');
    }
    const dueAmount = roundMoney(Math.max(taxResult.totalAmount - paidAmount, 0));
    const paymentStatus =
      paidAmount <= MONEY_EPSILON
        ? PaymentStatus.CREDIT
        : dueAmount <= MONEY_EPSILON
          ? PaymentStatus.PAID
          : PaymentStatus.PARTIAL;

    const saleNumber = await nextSaleNumber(tenantId);

    const [sale] = await Sale.create(
      [
        {
          tenantId,
          saleNumber,
          customerId: customer._id,
          saleDate: input.saleDate ?? new Date(),
          subTotal: taxResult.subTotal,
          discountAmount: taxResult.discountAmount,
          taxableAmount: taxResult.taxableAmount,
          cgstAmount: taxResult.cgstAmount,
          sgstAmount: taxResult.sgstAmount,
          igstAmount: taxResult.igstAmount,
          taxAmount: taxResult.taxAmount,
          taxType: taxResult.taxType,
          totalAmount: taxResult.totalAmount,
          paidAmount,
          dueAmount,
          paymentStatus,
          paymentMethod: input.paymentMethod,
          notes: input.notes,
          createdBy: userId,
        },
      ],
      { session }
    );

    const lineItems = input.items.map((item, index) => {
      const taxLine = taxResult.lines[index]!;
      return {
        productId: new Types.ObjectId(item.productId),
        quantity: taxLine.quantity,
        unitPrice: taxLine.unitPrice,
        taxRate: taxLine.taxRate,
        isPriceInclusive: taxLine.isPriceInclusive,
        discountAmount: taxLine.discountAmount,
        taxableAmount: taxLine.taxableAmount,
        cgstAmount: taxLine.cgstAmount,
        sgstAmount: taxLine.sgstAmount,
        igstAmount: taxLine.igstAmount,
        lineTotal: taxLine.lineTotal,
      };
    });

    await SaleItem.insertMany(
      lineItems.map((item) => ({ ...item, tenantId, saleId: sale._id })),
      { session }
    );

    // Stock is decremented per line item via the atomic guarded update in
    // inventory.service.ts. If any item has insufficient stock, this throws
    // InsufficientStockError and runInTransaction aborts the whole sale —
    // nothing partially commits, and no negative stock is ever possible
    // even under concurrent sales of the same product.
    for (const item of lineItems) {
      await applyStockChange({
        tenantId,
        productId: item.productId,
        type: InventoryTransactionType.SALE,
        quantity: item.quantity,
        referenceType: ReferenceType.SALE,
        referenceId: sale._id,
        performedBy: userId,
        session,
      });
    }

    // Any amount paid up front is a real payment, not just a Sale field —
    // record it in the same ledger that later "add payment" calls write to
    // (see customerPayment.service.ts) so the sale's payment history is
    // always complete, and every rupee ever received traces to one row.
    if (paidAmount > 0) {
      await CustomerPayment.create(
        [
          {
            tenantId,
            customerId: customer._id,
            saleId: sale._id,
            amount: paidAmount,
            method: input.paymentMethod ?? PaymentMethod.CASH,
            paymentDate: input.saleDate ?? new Date(),
            referenceNumber: input.paymentReference || undefined,
            notes: 'Initial payment at sale',
            recordedBy: userId,
          },
        ],
        { session }
      );
    }

    await recordAuditLog({
      tenantId,
      actorId: userId,
      actorRole: userRole,
      action: AuditAction.SALE_CREATED,
      entityType: 'Sale',
      entityId: sale._id,
      changes: {
        after: { saleNumber, totalAmount: taxResult.totalAmount, itemCount: lineItems.length },
      },
      ipAddress,
      session,
    });

    return sale;
  });
}

/**
 * Tenant-scoped list — `tenantId` always comes from the authenticated
 * caller's `req.user.tenantId`, never from a request parameter. Supports
 * the filters the Sales list screen needs: free-text search on sale
 * number, a specific customer, and a sale-date range.
 */
export async function listSales(
  tenantId: Types.ObjectId,
  query: Partial<ListSalesQuery>,
  pagination: PaginationParams
) {
  const filter: Record<string, unknown> = { tenantId };

  if (query.search?.trim()) {
    filter.saleNumber = { $regex: escapeRegex(query.search.trim()), $options: 'i' };
  }
  if (query.customerId) {
    filter.customerId = new Types.ObjectId(query.customerId);
  }
  if (query.fromDate || query.toDate) {
    const saleDate: Record<string, Date> = {};
    if (query.fromDate) saleDate.$gte = query.fromDate;
    if (query.toDate) saleDate.$lte = query.toDate;
    filter.saleDate = saleDate;
  }

  const [sales, total] = await Promise.all([
    Sale.find(filter)
      .populate('customerId', 'name mobileNumber')
      .populate('createdBy', 'name')
      .sort({ createdAt: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit),
    Sale.countDocuments(filter),
  ]);
  return { sales, meta: buildPaginationMeta(total, pagination.page, pagination.limit) };
}

export async function getSaleById(tenantId: Types.ObjectId, saleId: string) {
  const sale = await Sale.findOne({ _id: saleId, tenantId })
    .populate('customerId', 'name mobileNumber')
    .populate('createdBy', 'name');
  if (!sale) {
    throw new NotFoundError('Sale not found');
  }

  const items = await SaleItem.find({ tenantId, saleId: sale._id }).populate({
    path: 'productId',
    select: 'name sku unitId',
    populate: { path: 'unitId', select: 'name symbol' },
  });

  const payments = await CustomerPayment.find({ tenantId, saleId: sale._id })
    .sort({ paymentDate: -1 })
    .populate('recordedBy', 'name');

  return { sale, items, payments };
}

/**
 * Everything a Sales invoice document needs to render, composed from data
 * that already exists — business profile, tax registration, customer
 * details, and the sale's own persisted (never re-derived) tax breakdown.
 * Does not produce a PDF; just the structured data a future invoice
 * template/renderer would consume.
 */
export async function getSaleInvoiceData(tenantId: Types.ObjectId, saleId: string) {
  const [sale, tenant, taxConfig] = await Promise.all([
    Sale.findOne({ _id: saleId, tenantId }).populate('customerId'),
    Tenant.findById(tenantId),
    getEffectiveTaxConfig(tenantId),
  ]);
  if (!sale) {
    throw new NotFoundError('Sale not found');
  }

  const items = await SaleItem.find({ tenantId, saleId: sale._id }).populate({
    path: 'productId',
    select: 'name sku hsnCode unitId',
    populate: { path: 'unitId', select: 'name symbol' },
  });

  // .toJSON() first for anything that came from a hydrated Mongoose
  // document/subdocument (tenant, the populated customer) — that runs
  // each schema's own safe serialization (Decimal128 → number via
  // applyDecimalToJson, subdocuments → plain objects) and gives back
  // something with no circular internals. Embedding the live
  // document/subdocument directly and running the whole tree through
  // convertDecimals() below would walk into Mongoose's internal $__
  // structure and stack-overflow, exactly like the bug fixed in
  // report.service.ts::getExpenseReport.
  const tenantJson = tenant?.toJSON() as
    | {
        businessName?: string;
        address?: unknown;
        mobileNumber?: string;
        email?: string;
        gstNumber?: string;
        invoicePrefix?: string;
        invoiceFooterNote?: string;
      }
    | undefined;
  const customerJson = (sale.customerId as { toJSON?: () => unknown } | null)?.toJSON?.() as
    { name?: string; address?: unknown; gstNumber?: string } | undefined;

  const itemsData = items.map((item) => {
    const itemJson = item.toJSON() as unknown as {
      quantity: number;
      unitPrice: number;
      discountAmount: number;
      taxableAmount: number;
      taxRate: number;
      cgstAmount: number;
      sgstAmount: number;
      igstAmount: number;
      lineTotal: number;
    };
    const product = item.productId as unknown as {
      name: string;
      hsnCode?: string;
      unitId?: { symbol?: string };
    };
    return {
      productName: product?.name ?? null,
      hsnCode: product?.hsnCode ?? null,
      quantity: itemJson.quantity,
      unitSymbol: product?.unitId?.symbol ?? null,
      rate: itemJson.unitPrice,
      discount: itemJson.discountAmount,
      taxableValue: itemJson.taxableAmount,
      taxRate: itemJson.taxRate,
      cgst: itemJson.cgstAmount,
      sgst: itemJson.sgstAmount,
      igst: itemJson.igstAmount,
      lineTotal: itemJson.lineTotal,
    };
  });

  const saleJson = sale.toJSON() as unknown as {
    saleNumber: string;
    saleDate: Date;
    taxType: string;
    subTotal: number;
    discountAmount: number;
    taxableAmount: number;
    cgstAmount: number;
    sgstAmount: number;
    igstAmount: number;
    taxAmount: number;
    totalAmount: number;
  };

  return {
    business: {
      name: tenantJson?.businessName ?? null,
      address: tenantJson?.address ?? null,
      phone: tenantJson?.mobileNumber ?? null,
      email: tenantJson?.email ?? null,
      gstin: taxConfig.gstin ?? tenantJson?.gstNumber ?? null,
      invoicePrefix: tenantJson?.invoicePrefix ?? null,
      invoiceFooterNote: tenantJson?.invoiceFooterNote ?? null,
    },
    customer: {
      name: customerJson?.name ?? null,
      address: customerJson?.address ?? null,
      gstin: customerJson?.gstNumber ?? null,
    },
    // saleNumber stays the real, unique, sequential identifier
    // (nextSaleNumber) — invoicePrefix above is a display-only label a
    // client can prepend, never mixed into the number itself.
    invoiceNumber: saleJson.saleNumber,
    invoiceDate: saleJson.saleDate,
    taxType: saleJson.taxType,
    items: itemsData,
    subTotal: saleJson.subTotal,
    discountAmount: saleJson.discountAmount,
    taxableAmount: saleJson.taxableAmount,
    cgstAmount: saleJson.cgstAmount,
    sgstAmount: saleJson.sgstAmount,
    igstAmount: saleJson.igstAmount,
    totalTax: saleJson.taxAmount,
    grandTotal: saleJson.totalAmount,
  };
}
