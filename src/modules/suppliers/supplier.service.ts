import { Types, type PipelineStage } from 'mongoose';
import { Supplier } from '../../models/party.model';
import { Purchase } from '../../models/purchase.model';
import { AuditAction } from '../../constants/auditActions';
import { NotFoundError } from '../../utils/errors';
import { buildSearchFilter } from '../../utils/queryFilters';
import { convertDecimals } from '../../utils/schemaJson';
import { buildPaginationMeta, type PaginationParams } from '../../utils/pagination';
import { recordAuditLog } from '../auditLogs/auditLog.service';
import type { UserRole } from '../../types/enums';
import type {
  CreateSupplierInput,
  ListSuppliersQuery,
  SetSupplierStatusInput,
  SupplierPurchaseHistoryQuery,
  UpdateSupplierInput,
} from './supplier.validators';

export async function createSupplier(params: {
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  userRole: UserRole;
  input: CreateSupplierInput;
  ipAddress?: string;
}) {
  const { tenantId, userId, userRole, input, ipAddress } = params;
  const supplier = await Supplier.create({ tenantId, ...input });

  await recordAuditLog({
    tenantId,
    actorId: userId,
    actorRole: userRole,
    action: AuditAction.SUPPLIER_CREATED,
    entityType: 'Supplier',
    entityId: supplier._id,
    changes: { after: { name: supplier.name } },
    ipAddress,
  });

  return supplier;
}

export async function listSuppliers(
  tenantId: Types.ObjectId,
  query: Partial<ListSuppliersQuery>,
  pagination: PaginationParams
) {
  const filter: Record<string, unknown> = { tenantId };
  if (!query.status || query.status === 'active') {
    filter.isActive = true;
  } else if (query.status === 'inactive') {
    filter.isActive = false;
  }
  // status === 'all' leaves isActive unfiltered.

  if (query.search?.trim()) {
    Object.assign(filter, buildSearchFilter('name', query.search.trim()));
  }

  const [suppliers, total] = await Promise.all([
    Supplier.find(filter).sort({ name: 1 }).skip(pagination.skip).limit(pagination.limit),
    Supplier.countDocuments(filter),
  ]);

  return { suppliers, meta: buildPaginationMeta(total, pagination.page, pagination.limit) };
}

export async function getSupplierById(tenantId: Types.ObjectId, supplierId: string) {
  const supplier = await Supplier.findOne({ _id: supplierId, tenantId });
  if (!supplier) {
    throw new NotFoundError('Supplier not found');
  }
  return supplier;
}

export async function updateSupplier(params: {
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  userRole: UserRole;
  supplierId: string;
  input: UpdateSupplierInput;
  ipAddress?: string;
}) {
  const { tenantId, userId, userRole, supplierId, input, ipAddress } = params;

  const supplier = await Supplier.findOne({ _id: supplierId, tenantId });
  if (!supplier) {
    throw new NotFoundError('Supplier not found');
  }

  Object.assign(supplier, input);
  await supplier.save();

  await recordAuditLog({
    tenantId,
    actorId: userId,
    actorRole: userRole,
    action: AuditAction.SUPPLIER_UPDATED,
    entityType: 'Supplier',
    entityId: supplier._id,
    changes: { after: input },
    ipAddress,
  });

  return supplier;
}

/**
 * Deliberately a status flag, never a delete — see purchase.model.ts and
 * this module's routes: purchases already reference a supplier by id, and
 * "no physical deletion of purchases or purchase history" means a supplier
 * can never be removed out from under them either. Deactivating just stops
 * it from being offered when creating new purchases (see
 * purchase.service.ts::createPurchase's isActive check).
 */
export async function setSupplierStatus(params: {
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  userRole: UserRole;
  supplierId: string;
  input: SetSupplierStatusInput;
  ipAddress?: string;
}) {
  const { tenantId, userId, userRole, supplierId, input, ipAddress } = params;

  const supplier = await Supplier.findOne({ _id: supplierId, tenantId });
  if (!supplier) {
    throw new NotFoundError('Supplier not found');
  }

  supplier.isActive = input.isActive;
  await supplier.save();

  await recordAuditLog({
    tenantId,
    actorId: userId,
    actorRole: userRole,
    action: AuditAction.SUPPLIER_STATUS_CHANGED,
    entityType: 'Supplier',
    entityId: supplier._id,
    changes: { after: { isActive: input.isActive } },
    ipAddress,
  });

  return supplier;
}

/**
 * Purchase history + outstanding summary for one supplier — total spend,
 * invoice count, quantity purchased, and how much is still owed
 * (sum of Purchase.dueAmount), computed from the real Purchase/PurchaseItem
 * data rather than any separately-tracked running balance.
 */
export async function getSupplierPurchaseHistory(
  tenantId: Types.ObjectId,
  supplierId: string,
  query: Partial<SupplierPurchaseHistoryQuery>,
  pagination: PaginationParams
) {
  const supplier = await Supplier.findOne({ _id: supplierId, tenantId });
  if (!supplier) {
    throw new NotFoundError('Supplier not found');
  }

  const match: Record<string, unknown> = { tenantId, supplierId: supplier._id };
  if (query.fromDate || query.toDate) {
    const range: Record<string, Date> = {};
    if (query.fromDate) range.$gte = query.fromDate;
    if (query.toDate) range.$lte = query.toDate;
    match.purchaseDate = range;
  }

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

  const [summaryAgg, totalCountAgg, purchases] = await Promise.all([
    Purchase.aggregate([
      ...basePipeline,
      {
        $project: {
          totalAmount: 1,
          dueAmount: 1,
          quantity: { $sum: '$items.quantity' },
        },
      },
      {
        $group: {
          _id: null,
          totalPurchases: { $sum: 1 },
          totalAmount: { $sum: '$totalAmount' },
          totalQuantityPurchased: { $sum: '$quantity' },
          outstandingAmount: { $sum: '$dueAmount' },
        },
      },
    ]),
    Purchase.aggregate([...basePipeline, { $count: 'count' }]),
    Purchase.find(match)
      .sort({ purchaseDate: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .populate('createdBy', 'name'),
  ]);

  const summary = summaryAgg[0] ?? {
    totalPurchases: 0,
    totalAmount: 0,
    totalQuantityPurchased: 0,
    outstandingAmount: 0,
  };
  const total = totalCountAgg[0]?.count ?? 0;

  return {
    supplier,
    summary: convertDecimals({
      totalPurchases: summary.totalPurchases,
      totalAmount: summary.totalAmount,
      totalQuantityPurchased: summary.totalQuantityPurchased,
      outstandingAmount: summary.outstandingAmount,
    }),
    purchases,
    meta: buildPaginationMeta(total, pagination.page, pagination.limit),
  };
}
