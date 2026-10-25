import { Types, type Model, type PipelineStage } from 'mongoose';
import { Product } from '../../models/product.model';
import { InventoryTransaction } from '../../models/inventoryTransaction.model';
import { Sale, SaleItem } from '../../models/sale.model';
import { Purchase, PurchaseItem } from '../../models/purchase.model';
import { SaleReturn } from '../../models/saleReturn.model';
import { PurchaseReturn } from '../../models/purchaseReturn.model';
import { Expense } from '../../models/expense.model';
import {
  ExpenseStatus,
  InventoryTransactionType,
  ReferenceType,
  STOCK_INCREASING_TYPES,
} from '../../types/enums';
import { convertDecimals } from '../../utils/schemaJson';
import { roundMoney } from '../../utils/money';
import { escapeRegex } from '../../utils/queryFilters';
import { dayBounds, monthBounds } from '../../utils/dateRanges';
import { buildPaginationMeta, type PaginationParams } from '../../utils/pagination';
import type {
  ExpenseReportQuery,
  InventoryLedgerReportQuery,
  OutstandingCustomersReportQuery,
  ProfitReportQuery,
  PurchaseReportQuery,
  SalesReportQuery,
  StockReportQuery,
} from './report.validators';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Model.aggregate() returns plain JS objects, not Mongoose documents — a
 * schema's `toJSON` transform (see utils/schemaJson.ts) never runs on them,
 * so every aggregation result that touches a Decimal128 field (any money
 * amount) must be passed through this before it reaches sendSuccess/
 * sendPaginated, or the client gets `{ "$numberDecimal": "..." }` instead
 * of a number.
 */
function clean<T>(value: T): T {
  return convertDecimals(value) as T;
}

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

function buildDateRangeFilter(fromDate?: Date, toDate?: Date): Record<string, Date> | undefined {
  if (!fromDate && !toDate) return undefined;
  const range: Record<string, Date> = {};
  if (fromDate) range.$gte = fromDate;
  if (toDate) range.$lte = toDate;
  return range;
}

// ---------------------------------------------------------------------------
// 1. Dashboard summary
// ---------------------------------------------------------------------------

export async function getDashboardSummary(tenantId: Types.ObjectId) {
  const now = new Date();
  const { start: todayStart, end: todayEnd } = dayBounds(now);
  const { start: monthStart, end: monthEnd } = monthBounds(now);

  const [stockAgg, todaysSalesAgg, todaysPurchasesAgg, todaysExpensesAgg, thisMonthExpensesAgg] =
    await Promise.all([
      // Product-first, left-joined to Inventory — a product with no stock
      // movement yet has no Inventory document (see inventory.query.service.ts)
      // and must still count as an OUT_OF_STOCK product with 0 quantity/value,
      // not be silently skipped.
      Product.aggregate([
        { $match: { tenantId, isActive: true } },
        {
          $lookup: {
            from: 'inventories',
            localField: '_id',
            foreignField: 'productId',
            as: 'inventory',
          },
        },
        { $unwind: { path: '$inventory', preserveNullAndEmptyArrays: true } },
        {
          $addFields: {
            currentStock: { $ifNull: ['$inventory.currentStock', 0] },
          },
        },
        {
          $group: {
            _id: null,
            totalProducts: { $sum: 1 },
            totalStockQuantity: { $sum: '$currentStock' },
            totalStockValue: { $sum: { $multiply: ['$currentStock', '$purchasePrice'] } },
            lowStockProducts: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $gt: ['$currentStock', 0] },
                      { $lte: ['$currentStock', '$lowStockThreshold'] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            outOfStockProducts: { $sum: { $cond: [{ $lte: ['$currentStock', 0] }, 1, 0] } },
          },
        },
      ]),
      Sale.aggregate([
        { $match: { tenantId, saleDate: { $gte: todayStart, $lt: todayEnd } } },
        { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: '$totalAmount' } } },
      ]),
      Purchase.aggregate([
        { $match: { tenantId, purchaseDate: { $gte: todayStart, $lt: todayEnd } } },
        { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: '$totalAmount' } } },
      ]),
      Expense.aggregate([
        {
          $match: {
            tenantId,
            status: ExpenseStatus.ACTIVE,
            expenseDate: { $gte: todayStart, $lt: todayEnd },
          },
        },
        { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: '$amount' } } },
      ]),
      Expense.aggregate([
        {
          $match: {
            tenantId,
            status: ExpenseStatus.ACTIVE,
            expenseDate: { $gte: monthStart, $lt: monthEnd },
          },
        },
        { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: '$amount' } } },
      ]),
    ]);

  const stock = stockAgg[0] ?? {
    totalProducts: 0,
    totalStockQuantity: 0,
    totalStockValue: 0,
    lowStockProducts: 0,
    outOfStockProducts: 0,
  };
  const todaysSales = todaysSalesAgg[0] ?? { count: 0, amount: 0 };
  const todaysPurchases = todaysPurchasesAgg[0] ?? { count: 0, amount: 0 };
  const todaysExpenses = todaysExpensesAgg[0] ?? { count: 0, amount: 0 };
  const thisMonthExpenses = thisMonthExpensesAgg[0] ?? { count: 0, amount: 0 };

  return clean({
    totalProducts: stock.totalProducts,
    totalStockQuantity: stock.totalStockQuantity,
    totalStockValue: stock.totalStockValue,
    lowStockProducts: stock.lowStockProducts,
    outOfStockProducts: stock.outOfStockProducts,
    todaysSales: { count: todaysSales.count, amount: todaysSales.amount },
    todaysPurchases: { count: todaysPurchases.count, amount: todaysPurchases.amount },
    todaysExpenses: { count: todaysExpenses.count, amount: todaysExpenses.amount },
    thisMonthExpenses: { count: thisMonthExpenses.count, amount: thisMonthExpenses.amount },
  });
}

// ---------------------------------------------------------------------------
// 2. Sales report
// ---------------------------------------------------------------------------

export async function getSalesReport(
  tenantId: Types.ObjectId,
  query: Partial<SalesReportQuery>,
  pagination: PaginationParams
) {
  const match: Record<string, unknown> = { tenantId };
  if (query.customerId) match.customerId = new Types.ObjectId(query.customerId);
  const saleDateRange = buildDateRangeFilter(query.fromDate, query.toDate);
  if (saleDateRange) match.saleDate = saleDateRange;

  const productFilter = query.productId ? new Types.ObjectId(query.productId) : null;

  const basePipeline: PipelineStage[] = [
    { $match: match },
    { $lookup: { from: 'saleitems', localField: '_id', foreignField: 'saleId', as: 'items' } },
  ];
  if (productFilter) {
    basePipeline.push({ $match: { 'items.productId': productFilter } });
  }

  const [summaryAgg, totalCountAgg, sales] = await Promise.all([
    Sale.aggregate([
      ...basePipeline,
      {
        $project: {
          discountAmount: 1,
          taxAmount: 1,
          totalAmount: 1,
          matchedQuantity: productFilter
            ? {
                $sum: {
                  $map: {
                    input: {
                      $filter: {
                        input: '$items',
                        cond: { $eq: ['$$this.productId', productFilter] },
                      },
                    },
                    as: 'it',
                    in: '$$it.quantity',
                  },
                },
              }
            : { $sum: '$items.quantity' },
        },
      },
      {
        $group: {
          _id: null,
          totalSales: { $sum: 1 },
          totalQuantitySold: { $sum: '$matchedQuantity' },
          totalDiscount: { $sum: '$discountAmount' },
          totalTax: { $sum: '$taxAmount' },
          netSales: { $sum: '$totalAmount' },
        },
      },
    ]),
    Sale.aggregate([...basePipeline, { $count: 'count' }]),
    Sale.aggregate([
      ...basePipeline,
      { $sort: { saleDate: -1 } },
      { $skip: pagination.skip },
      { $limit: pagination.limit },
      {
        $lookup: {
          from: 'customers',
          localField: 'customerId',
          foreignField: '_id',
          as: 'customer',
        },
      },
      { $unwind: { path: '$customer', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: 'users', localField: 'createdBy', foreignField: '_id', as: 'creator' } },
      { $unwind: { path: '$creator', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          saleNumber: 1,
          saleDate: 1,
          subTotal: 1,
          taxAmount: 1,
          discountAmount: 1,
          totalAmount: 1,
          paymentStatus: 1,
          customer: { id: '$customer._id', name: '$customer.name' },
          createdBy: { id: '$creator._id', name: '$creator.name' },
        },
      },
    ]),
  ]);

  const summary = summaryAgg[0] ?? {
    totalSales: 0,
    totalQuantitySold: 0,
    totalDiscount: 0,
    totalTax: 0,
    netSales: 0,
  };
  const total = totalCountAgg[0]?.count ?? 0;

  return clean({
    summary: {
      totalSales: summary.totalSales,
      totalQuantitySold: summary.totalQuantitySold,
      totalDiscount: summary.totalDiscount,
      totalTax: summary.totalTax,
      netSales: summary.netSales,
    },
    sales,
    meta: buildPaginationMeta(total, pagination.page, pagination.limit),
  });
}

// ---------------------------------------------------------------------------
// 3. Purchase report — mirrors the sales report exactly for the supplier side.
// ---------------------------------------------------------------------------

export async function getPurchaseReport(
  tenantId: Types.ObjectId,
  query: Partial<PurchaseReportQuery>,
  pagination: PaginationParams
) {
  const match: Record<string, unknown> = { tenantId };
  if (query.supplierId) match.supplierId = new Types.ObjectId(query.supplierId);
  const purchaseDateRange = buildDateRangeFilter(query.fromDate, query.toDate);
  if (purchaseDateRange) match.purchaseDate = purchaseDateRange;

  const productFilter = query.productId ? new Types.ObjectId(query.productId) : null;

  const basePipeline: PipelineStage[] = [
    { $match: match },
    {
      $lookup: {
        from: 'purchaseitems',
        localField: '_id',
        foreignField: 'purchaseId',
        as: 'items',
      },
    },
  ];
  if (productFilter) {
    basePipeline.push({ $match: { 'items.productId': productFilter } });
  }

  const [summaryAgg, totalCountAgg, purchases] = await Promise.all([
    Purchase.aggregate([
      ...basePipeline,
      {
        $project: {
          taxAmount: 1,
          totalAmount: 1,
          matchedQuantity: productFilter
            ? {
                $sum: {
                  $map: {
                    input: {
                      $filter: {
                        input: '$items',
                        cond: { $eq: ['$$this.productId', productFilter] },
                      },
                    },
                    as: 'it',
                    in: '$$it.quantity',
                  },
                },
              }
            : { $sum: '$items.quantity' },
        },
      },
      {
        $group: {
          _id: null,
          totalPurchases: { $sum: 1 },
          totalQuantityPurchased: { $sum: '$matchedQuantity' },
          totalTax: { $sum: '$taxAmount' },
          netPurchaseAmount: { $sum: '$totalAmount' },
        },
      },
    ]),
    Purchase.aggregate([...basePipeline, { $count: 'count' }]),
    Purchase.aggregate([
      ...basePipeline,
      { $sort: { purchaseDate: -1 } },
      { $skip: pagination.skip },
      { $limit: pagination.limit },
      {
        $lookup: {
          from: 'suppliers',
          localField: 'supplierId',
          foreignField: '_id',
          as: 'supplier',
        },
      },
      { $unwind: { path: '$supplier', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: 'users', localField: 'createdBy', foreignField: '_id', as: 'creator' } },
      { $unwind: { path: '$creator', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          purchaseNumber: 1,
          purchaseDate: 1,
          subTotal: 1,
          taxAmount: 1,
          totalAmount: 1,
          paymentStatus: 1,
          supplier: { id: '$supplier._id', name: '$supplier.name' },
          createdBy: { id: '$creator._id', name: '$creator.name' },
        },
      },
    ]),
  ]);

  const summary = summaryAgg[0] ?? {
    totalPurchases: 0,
    totalQuantityPurchased: 0,
    totalTax: 0,
    netPurchaseAmount: 0,
  };
  const total = totalCountAgg[0]?.count ?? 0;

  // No discount field on Purchase — the create-purchase flow has never
  // captured a purchase-level discount (see purchase.model.ts), so this is
  // always 0 rather than a fabricated non-zero number.
  return clean({
    summary: {
      totalPurchases: summary.totalPurchases,
      totalQuantityPurchased: summary.totalQuantityPurchased,
      totalDiscount: 0,
      totalTax: summary.totalTax,
      netPurchaseAmount: summary.netPurchaseAmount,
    },
    purchases,
    meta: buildPaginationMeta(total, pagination.page, pagination.limit),
  });
}

// ---------------------------------------------------------------------------
// 4. Stock report
// ---------------------------------------------------------------------------

function stockStatusStage() {
  return {
    $addFields: {
      currentStock: { $ifNull: ['$inventory.currentStock', 0] },
      stockStatus: {
        $switch: {
          branches: [
            {
              case: { $lte: [{ $ifNull: ['$inventory.currentStock', 0] }, 0] },
              then: 'OUT_OF_STOCK',
            },
            {
              case: {
                $lte: [{ $ifNull: ['$inventory.currentStock', 0] }, '$lowStockThreshold'],
              },
              then: 'LOW_STOCK',
            },
          ],
          default: 'IN_STOCK',
        },
      },
    },
  };
}

export async function getStockReport(
  tenantId: Types.ObjectId,
  query: Partial<StockReportQuery>,
  pagination: PaginationParams
) {
  const matchStage: Record<string, unknown> = { tenantId, isActive: true };
  if (query.categoryId) matchStage.categoryId = new Types.ObjectId(query.categoryId);
  if (query.search?.trim()) {
    const term = escapeRegex(query.search.trim());
    matchStage.$or = [
      { name: { $regex: term, $options: 'i' } },
      { sku: { $regex: term, $options: 'i' } },
    ];
  }

  const pipeline: PipelineStage[] = [
    { $match: matchStage },
    {
      $lookup: {
        from: 'inventories',
        localField: '_id',
        foreignField: 'productId',
        as: 'inventory',
      },
    },
    { $unwind: { path: '$inventory', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'categories',
        localField: 'categoryId',
        foreignField: '_id',
        as: 'category',
      },
    },
    { $unwind: '$category' },
    stockStatusStage(),
    { $addFields: { stockValue: { $multiply: ['$currentStock', '$purchasePrice'] } } },
  ];

  if (query.status) {
    pipeline.push({ $match: { stockStatus: query.status } });
  }

  pipeline.push({
    $facet: {
      summary: [
        {
          $group: {
            _id: null,
            totalProducts: { $sum: 1 },
            totalStockQuantity: { $sum: '$currentStock' },
            totalStockValue: { $sum: '$stockValue' },
          },
        },
      ],
      data: [
        { $sort: { name: 1 } },
        { $skip: pagination.skip },
        { $limit: pagination.limit },
        {
          $project: {
            _id: 0,
            productId: '$_id',
            name: 1,
            sku: 1,
            category: { id: '$category._id', name: '$category.name' },
            currentStock: 1,
            lowStockThreshold: 1,
            purchasePrice: 1,
            sellingPrice: 1,
            stockValue: 1,
            stockStatus: 1,
          },
        },
      ],
      totalCount: [{ $count: 'count' }],
    },
  });

  const [result] = await Product.aggregate(pipeline);
  const items = result?.data ?? [];
  const total = result?.totalCount?.[0]?.count ?? 0;
  const summary = result?.summary?.[0] ?? {
    totalProducts: 0,
    totalStockQuantity: 0,
    totalStockValue: 0,
  };

  return clean({
    summary,
    items,
    meta: buildPaginationMeta(total, pagination.page, pagination.limit),
  });
}

// ---------------------------------------------------------------------------
// 5. Inventory ledger report (tenant-wide, unlike the per-product ledger at
// GET /inventory/:productId/transactions — this is the "all movement" view)
// ---------------------------------------------------------------------------

const REFERENCE_LOOKUPS: Partial<Record<ReferenceType, { model: Model<any>; field: string }>> = {
  [ReferenceType.SALE]: { model: Sale, field: 'saleNumber' },
  [ReferenceType.PURCHASE]: { model: Purchase, field: 'purchaseNumber' },
  [ReferenceType.SALE_RETURN]: { model: SaleReturn, field: 'returnNumber' },
  [ReferenceType.PURCHASE_RETURN]: { model: PurchaseReturn, field: 'returnNumber' },
};

/**
 * Resolves each transaction's (referenceType, referenceId) to a
 * human-readable number (e.g. "SL-000004") in a handful of batched
 * queries — one per referenceType present on the page — rather than a
 * conditional $lookup per collection in the aggregation pipeline. Simpler,
 * and cheap at report-page sizes (tens of rows, not thousands).
 * STOCK_ADJUSTMENT/SYSTEM references point at the product itself (see
 * stockAdjustment.service.ts, and legacy opening-stock rows), so there is no
 * separate document to resolve — they're left as just the type label.
 */
async function resolveReferenceNumbers(
  tenantId: Types.ObjectId,
  transactions: Array<{ referenceType: ReferenceType; referenceId: Types.ObjectId }>
): Promise<Map<string, string>> {
  const idsByType = new Map<ReferenceType, Set<string>>();
  for (const txn of transactions) {
    if (!REFERENCE_LOOKUPS[txn.referenceType]) continue;
    const set = idsByType.get(txn.referenceType) ?? new Set<string>();
    set.add(txn.referenceId.toString());
    idsByType.set(txn.referenceType, set);
  }

  const resolved = new Map<string, string>();
  await Promise.all(
    Array.from(idsByType.entries()).map(async ([referenceType, ids]) => {
      const lookup = REFERENCE_LOOKUPS[referenceType]!;
      const docs = await lookup.model
        .find({ tenantId, _id: { $in: Array.from(ids).map((id) => new Types.ObjectId(id)) } })
        .select(lookup.field);
      for (const doc of docs) {
        resolved.set(
          `${referenceType}:${doc._id.toString()}`,
          (doc as unknown as Record<string, string>)[lookup.field]
        );
      }
    })
  );
  return resolved;
}

export async function getInventoryLedgerReport(
  tenantId: Types.ObjectId,
  query: Partial<InventoryLedgerReportQuery>,
  pagination: PaginationParams
) {
  const filter: Record<string, unknown> = { tenantId };
  if (query.productId) filter.productId = new Types.ObjectId(query.productId);
  if (query.type) filter.type = query.type;
  const createdAtRange = buildDateRangeFilter(query.fromDate, query.toDate);
  if (createdAtRange) filter.createdAt = createdAtRange;

  const [transactions, total, summaryAgg] = await Promise.all([
    InventoryTransaction.find(filter)
      .sort({ createdAt: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .populate('productId', 'name sku')
      .populate('performedBy', 'name'),
    InventoryTransaction.countDocuments(filter),
    InventoryTransaction.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          totalIn: {
            $sum: {
              $cond: [{ $in: ['$type', Array.from(STOCK_INCREASING_TYPES)] }, '$quantity', 0],
            },
          },
          totalOut: {
            $sum: {
              $cond: [{ $in: ['$type', Array.from(STOCK_INCREASING_TYPES)] }, 0, '$quantity'],
            },
          },
        },
      },
    ]),
  ]);

  const referenceNumbers = await resolveReferenceNumbers(
    tenantId,
    transactions.map((t) => ({
      referenceType: t.referenceType as ReferenceType,
      referenceId: t.referenceId,
    }))
  );

  const rows = transactions.map((txn) => {
    const isIncrease = STOCK_INCREASING_TYPES.has(txn.type as InventoryTransactionType);
    const product = txn.productId as unknown as { _id: Types.ObjectId; name: string; sku: string };
    const performedBy = txn.performedBy as unknown as { _id: Types.ObjectId; name: string };
    return {
      id: txn._id,
      type: txn.type,
      product: { id: product._id, name: product.name, sku: product.sku },
      inQuantity: isIncrease ? txn.quantity : 0,
      outQuantity: isIncrease ? 0 : txn.quantity,
      previousStock: txn.previousStock,
      resultingStock: txn.resultingStock,
      reference: {
        type: txn.referenceType,
        id: txn.referenceId,
        number: referenceNumbers.get(`${txn.referenceType}:${txn.referenceId.toString()}`) ?? null,
      },
      createdBy: performedBy ? { id: performedBy._id, name: performedBy.name } : null,
      reason: txn.reason ?? null,
      notes: txn.notes ?? null,
      createdAt: txn.createdAt,
    };
  });

  const summary = summaryAgg[0] ?? { totalIn: 0, totalOut: 0 };

  return clean({
    summary: { totalIn: summary.totalIn, totalOut: summary.totalOut },
    transactions: rows,
    meta: buildPaginationMeta(total, pagination.page, pagination.limit),
  });
}

// ---------------------------------------------------------------------------
// 6. Profit summary
// ---------------------------------------------------------------------------

/**
 * Profit = what was sold minus what those units cost to buy, minus
 * operating expenses — all exclusive of GST, since GST collected on sales
 * is owed to the government and GST paid on purchases is claimable input
 * credit; neither is the business's own revenue or cost.
 *
 * COGS = quantity sold x the product's weighted-average purchase cost,
 * taken from every actual Purchase line for that product (taxable value /
 * quantity). This system doesn't do lot/FIFO costing, so an average over
 * all purchases is the cost basis. A product with no costed purchase (never
 * bought, or only stocked via ₹0 purchases) falls back to its configured
 * purchasePrice.
 */
export async function getProfitSummary(
  tenantId: Types.ObjectId,
  query: Partial<ProfitReportQuery>
) {
  const saleDateRange = buildDateRangeFilter(query.fromDate, query.toDate);
  const saleMatch: Record<string, unknown> = { tenantId };
  if (saleDateRange) saleMatch.saleDate = saleDateRange;

  // Operating expenses use the same fromDate/toDate window as sales, over
  // expenseDate — cancelled (soft-deleted) expenses are excluded, matching
  // expense.service.ts's summary/report calculations.
  const expenseMatch: Record<string, unknown> = { tenantId, status: ExpenseStatus.ACTIVE };
  if (saleDateRange) expenseMatch.expenseDate = saleDateRange;

  const [revenueAgg, soldAgg, expenseAgg] = await Promise.all([
    Sale.aggregate([
      { $match: saleMatch },
      {
        $group: {
          _id: null,
          salesRevenue: { $sum: { $subtract: ['$totalAmount', '$taxAmount'] } },
        },
      },
    ]),
    SaleItem.aggregate([
      { $match: { tenantId } },
      { $lookup: { from: 'sales', localField: 'saleId', foreignField: '_id', as: 'sale' } },
      { $unwind: '$sale' },
      { $match: saleDateRange ? { 'sale.saleDate': saleDateRange } : {} },
      { $group: { _id: '$productId', quantitySold: { $sum: '$quantity' } } },
    ]),
    Expense.aggregate([
      { $match: expenseMatch },
      { $group: { _id: null, operatingExpenses: { $sum: '$amount' } } },
    ]),
  ]);

  const soldProductIds = soldAgg.map((row: { _id: Types.ObjectId }) => row._id);
  const [purchaseCostAgg, products] = await Promise.all([
    PurchaseItem.aggregate([
      { $match: { tenantId, productId: { $in: soldProductIds } } },
      {
        $group: {
          _id: '$productId',
          quantityPurchased: { $sum: '$quantity' },
          // Taxable (pre-GST) value of the line.
          purchaseCost: {
            $sum: {
              $subtract: ['$lineTotal', { $add: ['$cgstAmount', '$sgstAmount', '$igstAmount'] }],
            },
          },
        },
      },
    ]),
    Product.find({ tenantId, _id: { $in: soldProductIds } }).select('purchasePrice'),
  ]);

  const averageCostByProduct = new Map<string, number>();
  for (const row of clean(purchaseCostAgg) as Array<{
    _id: Types.ObjectId;
    quantityPurchased: number;
    purchaseCost: unknown;
  }>) {
    const cost = toNumber(row.purchaseCost);
    if (row.quantityPurchased > 0 && cost > 0) {
      averageCostByProduct.set(row._id.toString(), cost / row.quantityPurchased);
    }
  }
  const fallbackCostByProduct = new Map(
    products.map((product) => [product._id.toString(), toNumber(product.purchasePrice?.toString())])
  );

  let costOfGoodsSold = 0;
  for (const row of soldAgg as Array<{ _id: Types.ObjectId; quantitySold: number }>) {
    const id = row._id.toString();
    const unitCost = averageCostByProduct.get(id) ?? fallbackCostByProduct.get(id) ?? 0;
    costOfGoodsSold += row.quantitySold * unitCost;
  }
  costOfGoodsSold = roundMoney(costOfGoodsSold);

  const salesRevenue = toNumber(clean(revenueAgg[0])?.salesRevenue);
  const grossProfit = roundMoney(salesRevenue - costOfGoodsSold);
  const grossMarginPercent = salesRevenue > 0 ? (grossProfit / salesRevenue) * 100 : 0;
  const operatingExpenses = toNumber(clean(expenseAgg[0])?.operatingExpenses);
  const netProfit = roundMoney(grossProfit - operatingExpenses);

  return {
    salesRevenue,
    costOfGoodsSold,
    grossProfit,
    grossMarginPercent: Math.round(grossMarginPercent * 100) / 100,
    operatingExpenses,
    netProfit,
  };
}

// ---------------------------------------------------------------------------
// 7. Outstanding customers report — every customer with a nonzero balance
// still owed, computed from Sale.dueAmount rather than a separately-tracked
// running balance (same source of truth as
// customer.service.ts::getCustomerSalesHistory).
// ---------------------------------------------------------------------------

export async function getOutstandingCustomersReport(
  tenantId: Types.ObjectId,
  query: Partial<OutstandingCustomersReportQuery>,
  pagination: PaginationParams
) {
  const pipeline: PipelineStage[] = [
    { $match: { tenantId } },
    {
      $group: {
        _id: '$customerId',
        totalSales: { $sum: '$totalAmount' },
        paidAmount: { $sum: '$paidAmount' },
        outstandingAmount: { $sum: '$dueAmount' },
        lastTransactionDate: { $max: '$saleDate' },
      },
    },
    { $match: { outstandingAmount: { $gt: 0 } } },
    { $lookup: { from: 'customers', localField: '_id', foreignField: '_id', as: 'customer' } },
    { $unwind: '$customer' },
  ];

  if (query.search?.trim()) {
    const term = escapeRegex(query.search.trim());
    pipeline.push({ $match: { 'customer.name': { $regex: term, $options: 'i' } } });
  }

  pipeline.push({
    $facet: {
      data: [
        { $sort: { outstandingAmount: -1 } },
        { $skip: pagination.skip },
        { $limit: pagination.limit },
        {
          $project: {
            _id: 0,
            customer: {
              id: '$customer._id',
              name: '$customer.name',
              mobileNumber: '$customer.mobileNumber',
            },
            totalSales: 1,
            paidAmount: 1,
            outstandingAmount: 1,
            lastTransactionDate: 1,
          },
        },
      ],
      totalCount: [{ $count: 'count' }],
      overallSummary: [
        {
          $group: {
            _id: null,
            totalOutstandingCustomers: { $sum: 1 },
            totalOutstandingAmount: { $sum: '$outstandingAmount' },
          },
        },
      ],
    },
  });

  const [result] = await Sale.aggregate(pipeline);
  const items = result?.data ?? [];
  const total = result?.totalCount?.[0]?.count ?? 0;
  const overallSummary = result?.overallSummary?.[0] ?? {
    totalOutstandingCustomers: 0,
    totalOutstandingAmount: 0,
  };

  return clean({
    summary: {
      totalOutstandingCustomers: overallSummary.totalOutstandingCustomers,
      totalOutstandingAmount: overallSummary.totalOutstandingAmount,
    },
    items,
    meta: buildPaginationMeta(total, pagination.page, pagination.limit),
  });
}

// ---------------------------------------------------------------------------
// 8. Expense report — date range, category and payment-method filtering,
// category breakdown, total. Cancelled (soft-deleted) expenses are always
// excluded, same as expense.service.ts's own list/summary.
// ---------------------------------------------------------------------------

export async function getExpenseReport(
  tenantId: Types.ObjectId,
  query: Partial<ExpenseReportQuery>,
  pagination: PaginationParams
) {
  const match: Record<string, unknown> = { tenantId, status: ExpenseStatus.ACTIVE };
  const expenseDateRange = buildDateRangeFilter(query.fromDate, query.toDate);
  if (expenseDateRange) match.expenseDate = expenseDateRange;
  if (query.categoryId) match.categoryId = new Types.ObjectId(query.categoryId);
  if (query.paymentMethod) match.paymentMethod = query.paymentMethod;

  const [summaryAgg, totalCountAgg, categoryBreakdownAgg, expenses] = await Promise.all([
    Expense.aggregate([
      { $match: match },
      { $group: { _id: null, totalExpenses: { $sum: 1 }, totalAmount: { $sum: '$amount' } } },
    ]),
    Expense.aggregate([{ $match: match }, { $count: 'count' }]),
    Expense.aggregate([
      { $match: match },
      { $group: { _id: '$categoryId', amount: { $sum: '$amount' }, count: { $sum: 1 } } },
      {
        $lookup: {
          from: 'expensecategories',
          localField: '_id',
          foreignField: '_id',
          as: 'category',
        },
      },
      { $unwind: '$category' },
      { $sort: { amount: -1 } },
      {
        $project: {
          _id: 0,
          categoryId: '$_id',
          categoryName: '$category.name',
          amount: 1,
          count: 1,
        },
      },
    ]),
    Expense.find(match)
      .sort({ expenseDate: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .populate('categoryId', 'name')
      .populate('createdBy', 'name'),
  ]);

  const summary = summaryAgg[0] ?? { totalExpenses: 0, totalAmount: 0 };
  const total = totalCountAgg[0]?.count ?? 0;

  // `expenses` are hydrated Mongoose documents (from .find()), not plain
  // aggregation output — they already get Decimal128→number conversion via
  // their own schema toJSON transform (applyDecimalToJson) when serialized,
  // and must NOT be passed through clean()/convertDecimals: that walks
  // plain objects recursively and stack-overflows on a live document's
  // internal circular structure. Only the aggregation results need it.
  return {
    summary: clean({ totalExpenses: summary.totalExpenses, totalAmount: summary.totalAmount }),
    categoryBreakdown: clean(categoryBreakdownAgg),
    expenses,
    meta: buildPaginationMeta(total, pagination.page, pagination.limit),
  };
}
