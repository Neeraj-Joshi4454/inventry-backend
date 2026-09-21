import { Types } from 'mongoose';
import { Product } from '../../models/product.model';
import { Category } from '../../models/category.model';
import { Unit } from '../../models/unit.model';
import { Inventory } from '../../models/inventory.model';
import { AuditAction } from '../../constants/auditActions';
import { BadRequestError, ConflictError, NotFoundError } from '../../utils/errors';
import { buildAllowedFilter, buildSearchFilter } from '../../utils/queryFilters';
import { buildPaginationMeta, type PaginationParams } from '../../utils/pagination';
import { runInTransaction } from '../../utils/withTransaction';
import { recordAuditLog } from '../auditLogs/auditLog.service';
import type { ClientSession } from 'mongoose';
import type { UserRole } from '../../types/enums';
import type { CreateProductInput, ListProductsQuery, UpdateProductInput } from './product.validators';

const PRODUCT_POPULATE = [
  { path: 'categoryId', select: 'name' },
  { path: 'unitId', select: 'name symbol' },
];

async function assertCategoryAndUnitBelongToTenant(
  tenantId: Types.ObjectId,
  categoryId: string,
  unitId: string,
  session: ClientSession
) {
  const [category, unit] = await Promise.all([
    Category.findOne({ _id: categoryId, tenantId }).session(session),
    Unit.findOne({ _id: unitId, tenantId }).session(session),
  ]);
  if (!category) throw new BadRequestError('Invalid category');
  if (!unit) throw new BadRequestError('Invalid unit');
  return { category, unit };
}

async function assertSkuNotTaken(
  tenantId: Types.ObjectId,
  sku: string,
  session: ClientSession,
  excludeProductId?: Types.ObjectId
) {
  const filter: Record<string, unknown> = { tenantId, sku: sku.toUpperCase() };
  if (excludeProductId) filter._id = { $ne: excludeProductId };
  const existing = await Product.findOne(filter).session(session);
  if (existing) {
    throw new ConflictError('Product SKU already exists.');
  }
}

/**
 * Atomically: validates category/unit belong to this tenant, checks the SKU
 * isn't already used (a pre-check for a clean error message, backed by the
 * unique index as the real race-safe guarantee — see the catch below),
 * creates the Product, and creates its Inventory record at currentStock: 0.
 *
 * Deliberately does NOT create an InventoryTransaction — a product existing
 * is not a stock event. Stock only ever enters the ledger through Opening
 * Stock, Purchase, Sale, Return, or Adjustment (inventory.service.ts).
 */
export async function createProduct(params: {
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  userRole: UserRole;
  input: CreateProductInput;
  ipAddress?: string;
}) {
  const { tenantId, userId, userRole, input, ipAddress } = params;

  try {
    const product = await runInTransaction(async (session) => {
      await assertCategoryAndUnitBelongToTenant(tenantId, input.categoryId, input.unitId, session);
      await assertSkuNotTaken(tenantId, input.sku, session);

      const [created] = await Product.create(
        [
          {
            tenantId,
            name: input.name,
            sku: input.sku.toUpperCase(),
            categoryId: input.categoryId,
            unitId: input.unitId,
            description: input.description,
            purchasePrice: input.purchasePrice,
            sellingPrice: input.sellingPrice,
            lowStockThreshold: input.lowStockThreshold,
            hsnCode: input.hsnCode,
            taxRate: input.taxRate,
            isPriceInclusive: input.isPriceInclusive,
          },
        ],
        { session }
      );

      await Inventory.create(
        [{ tenantId, productId: created._id, currentStock: 0, reservedStock: 0, version: 0 }],
        { session }
      );

      await recordAuditLog({
        tenantId,
        actorId: userId,
        actorRole: userRole,
        action: AuditAction.PRODUCT_CREATED,
        entityType: 'Product',
        entityId: created._id,
        changes: { after: { name: created.name, sku: created.sku } },
        ipAddress,
        session,
      });

      return created;
    });

    return await Product.findById(product._id).populate(PRODUCT_POPULATE);
  } catch (err) {
    // The pre-check above closes the common case with a clean message; this
    // catches the rare race (two concurrent creates with the same SKU) that
    // slips past it and still land on the unique index — never leak the raw
    // Mongo duplicate-key error to the client.
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: unknown }).code === 11000
    ) {
      throw new ConflictError('Product SKU already exists.');
    }
    throw err;
  }
}

const PRODUCT_SEARCH_FIELDS = ['sku'] as const;

export async function listProducts(
  tenantId: Types.ObjectId,
  query: Partial<ListProductsQuery>,
  pagination: PaginationParams
) {
  const filter = buildAllowedFilter<{ categoryId: string }>(query, ['categoryId']);
  Object.assign(filter, { tenantId, isActive: true });

  if (query.search?.trim()) {
    const term = query.search.trim();
    Object.assign(filter, {
      $or: [
        buildSearchFilter('name', term),
        ...PRODUCT_SEARCH_FIELDS.map((field) => buildSearchFilter(field, term)),
      ],
    });
  }

  const [products, total] = await Promise.all([
    Product.find(filter)
      .populate(PRODUCT_POPULATE)
      .sort({ name: 1 })
      .skip(pagination.skip)
      .limit(pagination.limit),
    Product.countDocuments(filter),
  ]);

  return { products, meta: buildPaginationMeta(total, pagination.page, pagination.limit) };
}

export async function getProductById(tenantId: Types.ObjectId, productId: string) {
  const product = await Product.findOne({ _id: productId, tenantId }).populate(PRODUCT_POPULATE);
  if (!product) {
    throw new NotFoundError('Product not found');
  }
  return product;
}

/**
 * Edits product info only — name, sku, category, unit, prices, threshold,
 * description. Never touches Inventory/currentStock: that field doesn't
 * even exist on this document (see inventory.model.ts), so there is
 * nothing here for an edit to accidentally corrupt. Stock changes only
 * ever happen through Opening Stock / Stock In / Sale / Return / Adjustment.
 */
export async function updateProduct(params: {
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  userRole: UserRole;
  productId: string;
  input: UpdateProductInput;
  ipAddress?: string;
}) {
  const { tenantId, userId, userRole, productId, input, ipAddress } = params;
  const productObjectId = new Types.ObjectId(productId);

  try {
    await runInTransaction(async (session) => {
      const product = await Product.findOne({ _id: productObjectId, tenantId }).session(session);
      if (!product) {
        throw new NotFoundError('Product not found');
      }

      if (input.categoryId || input.unitId) {
        await assertCategoryAndUnitBelongToTenant(
          tenantId,
          input.categoryId ?? product.categoryId.toString(),
          input.unitId ?? product.unitId.toString(),
          session
        );
      }
      if (input.sku && input.sku.toUpperCase() !== product.sku) {
        await assertSkuNotTaken(tenantId, input.sku, session, productObjectId);
      }

      const { categoryId, unitId, sku, ...rest } = input;
      Object.assign(product, rest);
      if (categoryId) product.categoryId = new Types.ObjectId(categoryId);
      if (unitId) product.unitId = new Types.ObjectId(unitId);
      if (sku) product.sku = sku.toUpperCase();
      await product.save({ session });

      await recordAuditLog({
        tenantId,
        actorId: userId,
        actorRole: userRole,
        action: AuditAction.PRODUCT_UPDATED,
        entityType: 'Product',
        entityId: product._id,
        changes: { after: input },
        ipAddress,
        session,
      });
    });

    return await Product.findOne({ _id: productObjectId, tenantId }).populate(PRODUCT_POPULATE);
  } catch (err) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: unknown }).code === 11000
    ) {
      throw new ConflictError('Product SKU already exists.');
    }
    throw err;
  }
}
