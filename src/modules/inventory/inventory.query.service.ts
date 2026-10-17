import { Types, type PipelineStage } from 'mongoose';
import { Product } from '../../models/product.model';
import { Inventory } from '../../models/inventory.model';
import { InventoryTransaction } from '../../models/inventoryTransaction.model';
import { NotFoundError } from '../../utils/errors';
import { escapeRegex } from '../../utils/queryFilters';
import { buildPaginationMeta, type PaginationParams } from '../../utils/pagination';
import type { ListInventoryQuery, ListTransactionsQuery } from './inventory.validators';

/**
 * Computes the same IN_STOCK / LOW_STOCK / OUT_OF_STOCK classification in
 * both the aggregation pipeline (Mongo-side, for filtering/listing) and here
 * (JS-side, for a single-product read) — kept as one literal `$switch` and
 * one literal if/else rather than factored into a shared "rule", since a
 * Mongo aggregation expression and a JS function can't share an
 * implementation; this comment is the thing keeping them in sync.
 */
function computeStatus(currentStock: number, lowStockThreshold: number): string {
  if (currentStock <= 0) return 'OUT_OF_STOCK';
  if (currentStock <= lowStockThreshold) return 'LOW_STOCK';
  return 'IN_STOCK';
}

export const STOCK_STATUS_MATCH_STAGE = {
  $addFields: {
    currentStock: { $ifNull: ['$inventory.currentStock', 0] },
    status: {
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

/**
 * Lists every active product enriched with its current stock — starting
 * the aggregation from Product (not Inventory) and left-joining Inventory
 * is deliberate: a product that has never had a stock movement has no
 * Inventory document yet at all, and must still show up here as
 * OUT_OF_STOCK / 0, not silently disappear from the list.
 */
export async function listInventory(
  tenantId: Types.ObjectId,
  query: Partial<ListInventoryQuery>,
  pagination: PaginationParams
) {
  const matchStage: Record<string, unknown> = { tenantId, isActive: true };
  if (query.categoryId) {
    matchStage.categoryId = new Types.ObjectId(query.categoryId);
  }
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
    { $lookup: { from: 'units', localField: 'unitId', foreignField: '_id', as: 'unit' } },
    { $unwind: '$unit' },
    {
      $lookup: {
        from: 'categories',
        localField: 'categoryId',
        foreignField: '_id',
        as: 'category',
      },
    },
    { $unwind: '$category' },
    STOCK_STATUS_MATCH_STAGE,
  ];

  if (query.status) {
    pipeline.push({ $match: { status: query.status } });
  }
  if (query.inStock) {
    pipeline.push({ $match: { currentStock: { $gt: 0 } } });
  }

  pipeline.push(
    { $sort: { name: 1 } },
    {
      $facet: {
        data: [
          { $skip: pagination.skip },
          { $limit: pagination.limit },
          {
            $project: {
              _id: 0,
              productId: '$_id',
              name: 1,
              sku: 1,
              category: { id: '$category._id', name: '$category.name' },
              unit: { id: '$unit._id', name: '$unit.name', symbol: '$unit.symbol' },
              currentStock: 1,
              lowStockThreshold: 1,
              status: 1,
              // Product-picker screens (Create Sale/Purchase) need these so
              // a newly-added line starts from the product's own tax
              // configuration rather than a hardcoded 0 — see
              // taxCalculation.service.ts for how the backend itself
              // ultimately resolves the rate either way.
              taxRate: { $ifNull: ['$taxRate', 0] },
              isPriceInclusive: { $ifNull: ['$isPriceInclusive', false] },
            },
          },
        ],
        totalCount: [{ $count: 'count' }],
      },
    }
  );

  const [result] = await Product.aggregate(pipeline);
  const items = result?.data ?? [];
  const total = result?.totalCount?.[0]?.count ?? 0;

  return { items, meta: buildPaginationMeta(total, pagination.page, pagination.limit) };
}

export async function getInventoryByProduct(tenantId: Types.ObjectId, productId: string) {
  const product = await Product.findOne({ _id: productId, tenantId })
    .populate('categoryId', 'name')
    .populate('unitId', 'name symbol');
  if (!product) {
    throw new NotFoundError('Product not found');
  }

  const inventory = await Inventory.findOne({ tenantId, productId: product._id });
  const currentStock = inventory?.currentStock ?? 0;

  return {
    productId: product._id,
    name: product.name,
    sku: product.sku,
    category: product.categoryId,
    unit: product.unitId,
    currentStock,
    lowStockThreshold: product.lowStockThreshold,
    status: computeStatus(currentStock, product.lowStockThreshold),
    taxRate: product.taxRate,
    isPriceInclusive: product.isPriceInclusive,
  };
}

export async function listInventoryTransactions(
  tenantId: Types.ObjectId,
  productId: string,
  query: Partial<ListTransactionsQuery>,
  pagination: PaginationParams
) {
  const product = await Product.findOne({ _id: productId, tenantId });
  if (!product) {
    throw new NotFoundError('Product not found');
  }

  const filter: Record<string, unknown> = { tenantId, productId: product._id };
  if (query.type) {
    filter.type = query.type;
  }
  if (query.fromDate || query.toDate) {
    const createdAt: Record<string, Date> = {};
    if (query.fromDate) createdAt.$gte = query.fromDate;
    if (query.toDate) createdAt.$lte = query.toDate;
    filter.createdAt = createdAt;
  }

  const [transactions, total] = await Promise.all([
    InventoryTransaction.find(filter)
      .sort({ createdAt: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit),
    InventoryTransaction.countDocuments(filter),
  ]);

  return {
    product: { id: product._id, name: product.name, sku: product.sku },
    transactions,
    meta: buildPaginationMeta(total, pagination.page, pagination.limit),
  };
}
