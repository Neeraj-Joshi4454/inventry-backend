import { Types, type PipelineStage } from 'mongoose';
import { Customer, Supplier } from '../../models/party.model';
import { Product } from '../../models/product.model';
import { Purchase } from '../../models/purchase.model';
import { Sale } from '../../models/sale.model';
import { Tenant } from '../../models/tenant.model';
import { DocumentStatus } from '../../types/enums';
import { NotFoundError } from '../../utils/errors';
import { buildPaginationMeta, type PaginationParams } from '../../utils/pagination';
import { escapeRegex } from '../../utils/queryFilters';
import { convertDecimals } from '../../utils/schemaJson';
import { STOCK_STATUS_MATCH_STAGE } from '../inventory/inventory.query.service';
import type {
  AdminReportQuery,
  ListAdminDocumentsQuery,
  ListAdminInventoryQuery,
  ListAdminProductsQuery,
} from './admin.validators';

/**
 * Read-only, cross-tenant views for the Super Admin panel. Every tenant-
 * scoped router (/sales, /products, ...) deliberately rejects SUPER_ADMIN
 * since it operates on req.user.tenantId; these endpoints are the explicit
 * platform-wide counterpart. Nothing here writes.
 */

// Cancelled documents never count toward any total shown to the admin.
const NOT_CANCELLED = { status: { $ne: DocumentStatus.CANCELLED } };

const TENANT_LOOKUP: PipelineStage[] = [
  {
    $lookup: {
      from: Tenant.collection.name,
      localField: 'tenantId',
      foreignField: '_id',
      as: 'tenant',
      pipeline: [{ $project: { businessName: 1 } }],
    },
  },
  { $unwind: { path: '$tenant', preserveNullAndEmptyArrays: true } },
];

function lookupName(from: string, localField: string, as: string): PipelineStage[] {
  return [
    {
      $lookup: {
        from,
        localField,
        foreignField: '_id',
        as,
        pipeline: [{ $project: { name: 1 } }],
      },
    },
    { $unwind: { path: `$${as}`, preserveNullAndEmptyArrays: true } },
  ];
}

function dateFilter(from?: Date, to?: Date) {
  if (!from && !to) return undefined;
  const range: Record<string, Date> = {};
  if (from) range.$gte = from;
  if (to) range.$lte = to;
  return range;
}

async function paginate(
  model: typeof Product | typeof Sale | typeof Purchase,
  pipeline: PipelineStage[],
  pagination: PaginationParams
) {
  const [result] = await (model as typeof Product).aggregate([
    ...pipeline,
    {
      $facet: {
        data: [{ $skip: pagination.skip }, { $limit: pagination.limit }],
        totalCount: [{ $count: 'count' }],
      },
    },
  ]);
  const items = convertDecimals(result?.data ?? []) as unknown[];
  const total = result?.totalCount?.[0]?.count ?? 0;
  return { items, meta: buildPaginationMeta(total, pagination.page, pagination.limit) };
}

/** Products joined to their inventory row, tenant, unit and category. */
function productStockPipeline(match: Record<string, unknown>): PipelineStage[] {
  return [
    { $match: match },
    {
      $lookup: {
        from: 'inventories',
        localField: '_id',
        foreignField: 'productId',
        as: 'inventory',
      },
    },
    { $unwind: { path: '$inventory', preserveNullAndEmptyArrays: true } },
    STOCK_STATUS_MATCH_STAGE,
    ...TENANT_LOOKUP,
    ...lookupName('units', 'unitId', 'unit'),
    ...lookupName('categories', 'categoryId', 'category'),
  ];
}

function productMatch(query: { tenantId?: string; search?: string }) {
  const match: Record<string, unknown> = {};
  if (query.tenantId) match.tenantId = new Types.ObjectId(query.tenantId);
  if (query.search) {
    const term = escapeRegex(query.search);
    match.$or = [
      { name: { $regex: term, $options: 'i' } },
      { sku: { $regex: term, $options: 'i' } },
    ];
  }
  return match;
}

const PRODUCT_PROJECTION = {
  _id: 1,
  name: 1,
  sku: 1,
  tenantId: 1,
  businessName: '$tenant.businessName',
  categoryName: '$category.name',
  unitSymbol: { $ifNull: ['$unit.symbol', '$unit.name'] },
  purchasePrice: 1,
  sellingPrice: 1,
  taxRate: { $ifNull: ['$taxRate', 0] },
  lowStockThreshold: 1,
  currentStock: 1,
  status: 1,
  isActive: 1,
  createdAt: 1,
};

export async function listProducts(query: Partial<ListAdminProductsQuery>, pagination: PaginationParams) {
  const match = productMatch(query);
  if (query.isActive) match.isActive = query.isActive === 'true';
  return paginate(
    Product,
    [...productStockPipeline(match), { $sort: { createdAt: -1 } }, { $project: PRODUCT_PROJECTION }],
    pagination
  );
}

/** Active products only — an inactive product has no meaningful stock position. */
export async function listInventory(query: Partial<ListAdminInventoryQuery>, pagination: PaginationParams) {
  const pipeline = productStockPipeline({ ...productMatch(query), isActive: true });
  if (query.status) pipeline.push({ $match: { status: query.status } });
  pipeline.push(
    // Most urgent first: out of stock, then low, then the rest by name.
    { $addFields: { _urgency: { $indexOfArray: [['OUT_OF_STOCK', 'LOW_STOCK', 'IN_STOCK'], '$status'] } } },
    { $sort: { _urgency: 1, currentStock: 1, name: 1 } },
    {
      $project: {
        ...PRODUCT_PROJECTION,
        stockValue: { $multiply: ['$currentStock', '$purchasePrice'] },
      },
    }
  );
  return paginate(Product, pipeline, pagination);
}

export async function listSales(query: Partial<ListAdminDocumentsQuery>, pagination: PaginationParams) {
  const match: Record<string, unknown> = {};
  if (query.tenantId) match.tenantId = new Types.ObjectId(query.tenantId);
  if (query.search) match.saleNumber = { $regex: escapeRegex(query.search), $options: 'i' };
  if (query.paymentStatus) match.paymentStatus = query.paymentStatus;
  const saleDate = dateFilter(query.fromDate, query.toDate);
  if (saleDate) match.saleDate = saleDate;

  return paginate(
    Sale,
    [
      { $match: match },
      { $sort: { saleDate: -1, createdAt: -1 } },
      ...TENANT_LOOKUP,
      ...lookupName(Customer.collection.name, 'customerId', 'customer'),
      {
        $project: {
          saleNumber: 1,
          saleDate: 1,
          tenantId: 1,
          businessName: '$tenant.businessName',
          customerName: '$customer.name',
          totalAmount: 1,
          paidAmount: 1,
          dueAmount: 1,
          paymentStatus: 1,
          paymentMethod: 1,
          status: 1,
        },
      },
    ],
    pagination
  );
}

export async function listPurchases(query: Partial<ListAdminDocumentsQuery>, pagination: PaginationParams) {
  const match: Record<string, unknown> = {};
  if (query.tenantId) match.tenantId = new Types.ObjectId(query.tenantId);
  if (query.search) {
    const term = escapeRegex(query.search);
    match.$or = [
      { purchaseNumber: { $regex: term, $options: 'i' } },
      { invoiceNumber: { $regex: term, $options: 'i' } },
    ];
  }
  if (query.paymentStatus) match.paymentStatus = query.paymentStatus;
  const purchaseDate = dateFilter(query.fromDate, query.toDate);
  if (purchaseDate) match.purchaseDate = purchaseDate;

  return paginate(
    Purchase,
    [
      { $match: match },
      { $sort: { purchaseDate: -1, createdAt: -1 } },
      ...TENANT_LOOKUP,
      ...lookupName(Supplier.collection.name, 'supplierId', 'supplier'),
      {
        $project: {
          purchaseNumber: 1,
          invoiceNumber: 1,
          purchaseDate: 1,
          tenantId: 1,
          businessName: '$tenant.businessName',
          supplierName: '$supplier.name',
          totalAmount: 1,
          paidAmount: 1,
          dueAmount: 1,
          paymentStatus: 1,
          status: 1,
        },
      },
    ],
    pagination
  );
}

function documentTotals(model: typeof Sale | typeof Purchase, match: Record<string, unknown>) {
  return (model as typeof Sale).aggregate([
    { $match: { ...NOT_CANCELLED, ...match } },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        amount: { $sum: '$totalAmount' },
        due: { $sum: '$dueAmount' },
      },
    },
  ]);
}

function stockTotals(match: Record<string, unknown>) {
  return Product.aggregate([
    { $match: { ...match, isActive: true } },
    {
      $lookup: {
        from: 'inventories',
        localField: '_id',
        foreignField: 'productId',
        as: 'inventory',
      },
    },
    { $unwind: { path: '$inventory', preserveNullAndEmptyArrays: true } },
    STOCK_STATUS_MATCH_STAGE,
    {
      $group: {
        _id: null,
        products: { $sum: 1 },
        stockQuantity: { $sum: '$currentStock' },
        stockValue: { $sum: { $multiply: ['$currentStock', '$purchasePrice'] } },
        lowStock: { $sum: { $cond: [{ $eq: ['$status', 'LOW_STOCK'] }, 1, 0] } },
        outOfStock: { $sum: { $cond: [{ $eq: ['$status', 'OUT_OF_STOCK'] }, 1, 0] } },
      },
    },
  ]);
}

function amounts(row: { count?: number; amount?: unknown; due?: unknown } | undefined) {
  const converted = convertDecimals(row ?? {}) as { count?: number; amount?: number; due?: number };
  return { count: converted.count ?? 0, amount: converted.amount ?? 0, due: converted.due ?? 0 };
}

function stock(row: Record<string, unknown> | undefined) {
  const s = convertDecimals(row ?? {}) as Record<string, number | undefined>;
  return {
    products: s.products ?? 0,
    stockQuantity: s.stockQuantity ?? 0,
    stockValue: s.stockValue ?? 0,
    lowStock: s.lowStock ?? 0,
    outOfStock: s.outOfStock ?? 0,
  };
}

/** Platform-wide dashboard: headline totals plus recent activity and stock alerts. */
export async function getOverview() {
  const page = { page: 1, limit: 5, skip: 0 };
  const [stockAgg, salesAgg, purchasesAgg, recentSales, recentPurchases, lowStock] =
    await Promise.all([
      stockTotals({}),
      documentTotals(Sale, {}),
      documentTotals(Purchase, {}),
      listSales({}, page),
      listPurchases({}, page),
      listInventory({}, { page: 1, limit: 8, skip: 0 }),
    ]);

  return {
    stock: stock(stockAgg[0]),
    sales: amounts(salesAgg[0]),
    purchases: amounts(purchasesAgg[0]),
    recentSales: recentSales.items,
    recentPurchases: recentPurchases.items,
    // listInventory sorts most urgent first, so anything in stock here
    // means there are no alerts at all.
    lowStock: (lowStock.items as { status: string }[]).filter((p) => p.status !== 'IN_STOCK'),
  };
}

/** Per-business counters for the business detail page. */
export async function getTenantStats(tenantId: string) {
  const id = new Types.ObjectId(tenantId);
  const tenant = await Tenant.exists({ _id: id });
  if (!tenant) throw new NotFoundError('Tenant not found');

  const [stockAgg, salesAgg, purchasesAgg, customers, suppliers] = await Promise.all([
    stockTotals({ tenantId: id }),
    documentTotals(Sale, { tenantId: id }),
    documentTotals(Purchase, { tenantId: id }),
    Customer.countDocuments({ tenantId: id, isActive: true }),
    Supplier.countDocuments({ tenantId: id, isActive: true }),
  ]);

  return {
    stock: stock(stockAgg[0]),
    sales: amounts(salesAgg[0]),
    purchases: amounts(purchasesAgg[0]),
    customers,
    suppliers,
  };
}

/**
 * Sales vs purchases for a date range: platform totals, a per-business
 * breakdown (every business, including ones with no activity), and a
 * month-by-month trend.
 */
export async function getReport(query: Partial<AdminReportQuery>) {
  const saleDate = dateFilter(query.fromDate, query.toDate);
  const purchaseDate = dateFilter(query.fromDate, query.toDate);
  const saleMatch = { ...NOT_CANCELLED, ...(saleDate ? { saleDate } : {}) };
  const purchaseMatch = { ...NOT_CANCELLED, ...(purchaseDate ? { purchaseDate } : {}) };

  const groupByTenant = {
    $group: {
      _id: '$tenantId',
      count: { $sum: 1 },
      amount: { $sum: '$totalAmount' },
      due: { $sum: '$dueAmount' },
    },
  };
  const groupByMonth = (dateField: string) => ({
    $group: {
      _id: { $dateToString: { format: '%Y-%m', date: `$${dateField}` } },
      amount: { $sum: '$totalAmount' },
      count: { $sum: 1 },
    },
  });

  const [tenants, salesByTenant, purchasesByTenant, salesByMonth, purchasesByMonth] =
    await Promise.all([
      Tenant.find({}, { businessName: 1, status: 1 }).sort({ businessName: 1 }).lean(),
      Sale.aggregate([{ $match: saleMatch }, groupByTenant]),
      Purchase.aggregate([{ $match: purchaseMatch }, groupByTenant]),
      Sale.aggregate([{ $match: saleMatch }, groupByMonth('saleDate')]),
      Purchase.aggregate([{ $match: purchaseMatch }, groupByMonth('purchaseDate')]),
    ]);

  const byId = (rows: { _id: Types.ObjectId }[]) =>
    new Map(rows.map((r) => [r._id.toString(), amounts(r as never)]));
  const salesMap = byId(salesByTenant);
  const purchasesMap = byId(purchasesByTenant);
  const empty = { count: 0, amount: 0, due: 0 };

  const businesses = tenants
    .map((t) => ({
      tenantId: t._id.toString(),
      businessName: t.businessName,
      status: t.status,
      sales: salesMap.get(t._id.toString()) ?? empty,
      purchases: purchasesMap.get(t._id.toString()) ?? empty,
    }))
    .sort((a, b) => b.sales.amount - a.sales.amount);

  const sum = (rows: { count: number; amount: number; due: number }[]) =>
    rows.reduce(
      (acc, r) => ({ count: acc.count + r.count, amount: acc.amount + r.amount, due: acc.due + r.due }),
      { ...empty }
    );

  const months = new Map<string, { month: string; sales: number; purchases: number }>();
  for (const row of convertDecimals(salesByMonth) as { _id: string; amount: number }[]) {
    months.set(row._id, { month: row._id, sales: row.amount, purchases: 0 });
  }
  for (const row of convertDecimals(purchasesByMonth) as { _id: string; amount: number }[]) {
    const entry = months.get(row._id) ?? { month: row._id, sales: 0, purchases: 0 };
    entry.purchases = row.amount;
    months.set(row._id, entry);
  }

  return {
    totals: {
      sales: sum(businesses.map((b) => b.sales)),
      purchases: sum(businesses.map((b) => b.purchases)),
    },
    businesses,
    monthly: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)),
  };
}
