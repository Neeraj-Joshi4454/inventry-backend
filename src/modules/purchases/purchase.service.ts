import { Types } from 'mongoose';
import { Purchase, PurchaseItem } from '../../models/purchase.model';
import { Product } from '../../models/product.model';
import { Supplier } from '../../models/party.model';
import { InventoryTransaction } from '../../models/inventoryTransaction.model';
import { Tenant } from '../../models/tenant.model';
import { applyStockChange } from '../inventory/inventory.service';
import { getEffectiveTaxConfig } from '../taxes/tax.service';
import { calculateDocumentTax, resolveTaxSplit } from '../taxes/taxCalculation.service';
import { InventoryTransactionType, PaymentStatus, ReferenceType } from '../../types/enums';
import { AuditAction } from '../../constants/auditActions';
import { BadRequestError, NotFoundError } from '../../utils/errors';
import { escapeRegex } from '../../utils/queryFilters';
import { runInTransaction } from '../../utils/withTransaction';
import { buildPaginationMeta, type PaginationParams } from '../../utils/pagination';
import { recordAuditLog } from '../auditLogs/auditLog.service';
import type { UserRole } from '../../types/enums';
import type { CreatePurchaseInput, ListPurchasesQuery } from './purchase.validators';

async function nextPurchaseNumber(tenantId: Types.ObjectId): Promise<string> {
  // Same simple per-tenant sequential scheme as sale.service.ts::nextSaleNumber
  // — see that file's comment for the collision/upgrade-path tradeoff.
  const count = await Purchase.countDocuments({ tenantId });
  return `PO-${String(count + 1).padStart(6, '0')}`;
}

/**
 * Atomically: validates the supplier and every line item's product
 * (existence, tenant ownership, active status) up front, creates the
 * Purchase + PurchaseItems, and increases stock per line item via
 * inventory.service.ts::applyStockChange (PURCHASE type). All of it commits
 * or rolls back together — an invalid product on line 3 of a 5-item
 * purchase leaves zero trace, not a partially-created purchase with only
 * some items stocked in.
 */
export async function createPurchase(params: {
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  userRole: UserRole;
  input: CreatePurchaseInput;
  ipAddress?: string;
}) {
  const { tenantId, userId, userRole, input, ipAddress } = params;

  return runInTransaction(async (session) => {
    const supplier = await Supplier.findOne({ _id: input.supplierId, tenantId }).session(session);
    if (!supplier) {
      throw new NotFoundError('Supplier not found');
    }
    if (!supplier.isActive) {
      throw new BadRequestError('Cannot purchase from an inactive supplier');
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
    // configured GST regime and each product's own tax settings — same
    // reusable engine sale.service.ts uses, never duplicated logic (see
    // taxCalculation.service.ts).
    const taxConfig = await getEffectiveTaxConfig(tenantId);
    const supplierState = supplier.address?.state;
    const taxSplit = resolveTaxSplit(taxConfig, supplierState);

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

    const purchaseNumber = await nextPurchaseNumber(tenantId);

    const [purchase] = await Purchase.create(
      [
        {
          tenantId,
          purchaseNumber,
          invoiceNumber: input.invoiceNumber,
          supplierId: supplier._id,
          purchaseDate: input.purchaseDate ?? new Date(),
          subTotal: taxResult.subTotal,
          discountAmount: taxResult.discountAmount,
          taxableAmount: taxResult.taxableAmount,
          cgstAmount: taxResult.cgstAmount,
          sgstAmount: taxResult.sgstAmount,
          igstAmount: taxResult.igstAmount,
          taxAmount: taxResult.taxAmount,
          taxType: taxResult.taxType,
          totalAmount: taxResult.totalAmount,
          paidAmount: 0,
          dueAmount: taxResult.totalAmount,
          paymentStatus: PaymentStatus.UNPAID,
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

    await PurchaseItem.insertMany(
      lineItems.map((item) => ({ ...item, tenantId, purchaseId: purchase._id })),
      { session }
    );

    // Stock increases per line item — PURCHASE is an unguarded increase in
    // applyStockChange, so this only ever fails on a genuine infra error,
    // never a "not enough stock" condition (that only applies to decreases).
    for (const item of lineItems) {
      await applyStockChange({
        tenantId,
        productId: item.productId,
        type: InventoryTransactionType.PURCHASE,
        quantity: item.quantity,
        referenceType: ReferenceType.PURCHASE,
        referenceId: purchase._id,
        performedBy: userId,
        session,
      });
    }

    await recordAuditLog({
      tenantId,
      actorId: userId,
      actorRole: userRole,
      action: AuditAction.PURCHASE_CREATED,
      entityType: 'Purchase',
      entityId: purchase._id,
      changes: {
        after: { purchaseNumber, totalAmount: taxResult.totalAmount, itemCount: lineItems.length },
      },
      ipAddress,
      session,
    });

    return purchase;
  });
}

/**
 * Tenant-scoped list — mirrors sale.service.ts::listSales's filter shape
 * (search on the document number, a specific counterparty, a date range)
 * for the same screen-level needs on the purchase side, plus the export
 * module (see modules/exports/export.service.ts).
 */
export async function listPurchases(
  tenantId: Types.ObjectId,
  query: Partial<ListPurchasesQuery>,
  pagination: PaginationParams
) {
  const filter: Record<string, unknown> = { tenantId };

  if (query.search?.trim()) {
    filter.purchaseNumber = { $regex: escapeRegex(query.search.trim()), $options: 'i' };
  }
  if (query.supplierId) {
    filter.supplierId = new Types.ObjectId(query.supplierId);
  }
  if (query.fromDate || query.toDate) {
    const purchaseDate: Record<string, Date> = {};
    if (query.fromDate) purchaseDate.$gte = query.fromDate;
    if (query.toDate) purchaseDate.$lte = query.toDate;
    filter.purchaseDate = purchaseDate;
  }

  const [purchases, total] = await Promise.all([
    Purchase.find(filter)
      .populate('supplierId', 'name')
      .sort({ createdAt: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit),
    Purchase.countDocuments(filter),
  ]);
  return { purchases, meta: buildPaginationMeta(total, pagination.page, pagination.limit) };
}

export async function getPurchaseById(tenantId: Types.ObjectId, purchaseId: string) {
  const purchase = await Purchase.findOne({ _id: purchaseId, tenantId })
    .populate('supplierId', 'name mobileNumber contactPerson')
    .populate('createdBy', 'name');
  if (!purchase) {
    throw new NotFoundError('Purchase not found');
  }

  const items = await PurchaseItem.find({ tenantId, purchaseId: purchase._id }).populate({
    path: 'productId',
    select: 'name sku unitId',
    populate: { path: 'unitId', select: 'name symbol' },
  });

  // The inventory impact of this purchase — one PURCHASE transaction per
  // line item, created atomically alongside it (see createPurchase).
  // Read-only lookup; never a second write path for stock.
  const inventoryTransactions = await InventoryTransaction.find({
    tenantId,
    referenceType: ReferenceType.PURCHASE,
    referenceId: purchase._id,
  });
  const inventoryImpactByProduct = new Map(
    inventoryTransactions.map((txn) => [
      txn.productId.toString(),
      { previousStock: txn.previousStock, resultingStock: txn.resultingStock },
    ])
  );

  const itemsWithImpact = items.map((item) => {
    const product = item.productId as unknown as { _id: Types.ObjectId };
    return {
      ...item.toJSON(),
      inventoryImpact: inventoryImpactByProduct.get(product._id.toString()) ?? null,
    };
  });

  return { purchase, items: itemsWithImpact };
}

/**
 * Everything a Purchase bill/voucher needs to render, for our own
 * records — the purchase-side mirror of
 * sale.service.ts::getSaleInvoiceData: business profile (ourselves, the
 * buyer), tax registration, the supplier's details, and the purchase's
 * own persisted (never re-derived) tax breakdown. Does not produce a PDF;
 * just the structured data a renderer would consume.
 */
export async function getPurchaseInvoiceData(tenantId: Types.ObjectId, purchaseId: string) {
  const [purchase, tenant, taxConfig] = await Promise.all([
    Purchase.findOne({ _id: purchaseId, tenantId }).populate('supplierId'),
    Tenant.findById(tenantId),
    getEffectiveTaxConfig(tenantId),
  ]);
  if (!purchase) {
    throw new NotFoundError('Purchase not found');
  }

  const items = await PurchaseItem.find({ tenantId, purchaseId: purchase._id }).populate({
    path: 'productId',
    select: 'name sku hsnCode unitId',
    populate: { path: 'unitId', select: 'name symbol' },
  });

  // .toJSON() first for anything that came from a hydrated Mongoose
  // document/subdocument (tenant, the populated supplier) — see the
  // identical note in sale.service.ts::getSaleInvoiceData for why the live
  // document must never be embedded directly.
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
  const supplierJson = (purchase.supplierId as { toJSON?: () => unknown } | null)?.toJSON?.() as
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

  const purchaseJson = purchase.toJSON() as unknown as {
    purchaseNumber: string;
    invoiceNumber?: string;
    purchaseDate: Date;
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
    supplier: {
      name: supplierJson?.name ?? null,
      address: supplierJson?.address ?? null,
      gstin: supplierJson?.gstNumber ?? null,
    },
    // purchaseNumber is the real, unique, sequential identifier (see
    // nextPurchaseNumber) — the supplier's own bill number, when they gave
    // one, is surfaced separately as supplierInvoiceNumber rather than
    // overwriting it, exactly like invoicePrefix is display-only above.
    invoiceNumber: purchaseJson.purchaseNumber,
    supplierInvoiceNumber: purchaseJson.invoiceNumber ?? null,
    invoiceDate: purchaseJson.purchaseDate,
    taxType: purchaseJson.taxType,
    items: itemsData,
    subTotal: purchaseJson.subTotal,
    discountAmount: purchaseJson.discountAmount,
    taxableAmount: purchaseJson.taxableAmount,
    cgstAmount: purchaseJson.cgstAmount,
    sgstAmount: purchaseJson.sgstAmount,
    igstAmount: purchaseJson.igstAmount,
    totalTax: purchaseJson.taxAmount,
    grandTotal: purchaseJson.totalAmount,
  };
}
