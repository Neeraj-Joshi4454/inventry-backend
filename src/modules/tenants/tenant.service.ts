import { Types } from 'mongoose';
import { Tenant } from '../../models/tenant.model';
import { User } from '../../models/user.model';
import { Category } from '../../models/category.model';
import { Unit } from '../../models/unit.model';
import { ExpenseCategory } from '../../models/expenseCategory.model';
import { TaxConfig } from '../../models/taxConfig.model';
import { AccountStatus, UserRole } from '../../types/enums';
import { AuditAction } from '../../constants/auditActions';
import { ConflictError, NotFoundError } from '../../utils/errors';
import { hashPassword } from '../../utils/password';
import { runInTransaction } from '../../utils/withTransaction';
import {
  DEFAULT_CATEGORIES,
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_UNITS,
} from '../../constants/seedData';
import { buildPaginationMeta, type PaginationParams } from '../../utils/pagination';
import { buildSearchFilter, buildSortOption } from '../../utils/queryFilters';
import { recordAuditLog } from '../auditLogs/auditLog.service';
import type { CreateTenantInput, ListTenantsQuery, UpdateTenantInput } from './tenant.validators';
import type { FilterQuery } from 'mongoose';
import type { TenantDocument } from '../../models/tenant.model';

export interface CreateTenantActor {
  superAdminId: Types.ObjectId;
  ipAddress?: string;
}

/**
 * Creates a Tenant and its first OWNER user atomically, and auto-provisions
 * a default construction-materials category/unit catalog so the business
 * isn't starting from a completely empty product screen. Categories/units
 * are tenant-owned (see category.model.ts) — this is just a starter set the
 * tenant can edit or delete freely afterwards.
 *
 * If the admin mobile number is already taken (global uniqueness — see
 * architecture decision), the whole operation rolls back rather than
 * leaving an orphan tenant — including the audit log entry, which is
 * written inside the same transaction so it never records a tenant that
 * didn't actually end up committed.
 */
export async function createTenantWithOwner(actor: CreateTenantActor, input: CreateTenantInput) {
  const { superAdminId } = actor;
  return runInTransaction(async (session) => {
    const existing = await User.findOne({ mobileNumber: input.adminUser.mobileNumber }).session(
      session
    );
    if (existing) {
      throw new ConflictError('This mobile number is already registered to an account');
    }

    const [tenant] = await Tenant.create(
      [
        {
          businessName: input.businessName,
          ownerName: input.ownerName,
          mobileNumber: input.businessMobileNumber,
          email: input.email,
          gstNumber: input.gstNumber,
          address: input.address,
          status: AccountStatus.ACTIVE,
          createdBy: superAdminId,
        },
      ],
      { session }
    );

    const passwordHash = await hashPassword(input.adminUser.password);

    const [adminUser] = await User.create(
      [
        {
          tenantId: tenant._id,
          name: input.adminUser.name,
          mobileNumber: input.adminUser.mobileNumber,
          passwordHash,
          role: UserRole.OWNER,
          status: AccountStatus.ACTIVE,
          mustChangePassword: true,
          createdBy: superAdminId,
        },
      ],
      { session }
    );

    await Category.insertMany(
      DEFAULT_CATEGORIES.map((c) => ({ ...c, tenantId: tenant._id })),
      { session }
    );
    await Unit.insertMany(
      DEFAULT_UNITS.map((u) => ({ ...u, tenantId: tenant._id })),
      { session }
    );
    await ExpenseCategory.insertMany(
      DEFAULT_EXPENSE_CATEGORIES.map((c) => ({ ...c, tenantId: tenant._id, isSystem: true })),
      { session }
    );
    // GST stays enabled by default (see tax.service.ts's DEFAULT_TAX_CONFIG
    // comment for why) — pre-filling state/gstin here is just a
    // convenience if they were already entered on the business profile.
    await TaxConfig.create(
      [
        {
          tenantId: tenant._id,
          gstEnabled: true,
          gstin: input.gstNumber,
          state: input.address?.state,
        },
      ],
      { session }
    );

    await recordAuditLog({
      tenantId: tenant._id as Types.ObjectId,
      actorId: superAdminId,
      actorRole: UserRole.SUPER_ADMIN,
      action: AuditAction.TENANT_CREATED,
      entityType: 'Tenant',
      entityId: tenant._id as Types.ObjectId,
      changes: {
        after: { businessName: tenant.businessName, ownerMobile: adminUser.mobileNumber },
      },
      ipAddress: actor.ipAddress,
      session,
    });

    return { tenant, adminUser };
  });
}

const TENANT_SORT_FIELDS = ['businessName', 'createdAt', 'status'] as const;

export async function listTenants(
  pagination: PaginationParams,
  query: Partial<ListTenantsQuery> = {}
) {
  const filter: FilterQuery<TenantDocument> = {};
  if (query.status) {
    filter.status = query.status;
  }
  if (query.search) {
    // businessName / ownerName / mobileNumber match, any one of the three —
    // built from the same escaped-regex search helper used elsewhere, never
    // a raw user string passed straight into a Mongo operator.
    const term = query.search.trim();
    if (term) {
      filter.$or = [
        buildSearchFilter('businessName', term),
        buildSearchFilter('ownerName', term),
        buildSearchFilter('mobileNumber', term),
      ].filter((clause) => Object.keys(clause).length > 0) as FilterQuery<TenantDocument>[];
    }
  }

  const sort = buildSortOption(query.sortBy, query.sortOrder, TENANT_SORT_FIELDS, {
    createdAt: -1,
  });

  const [tenants, total] = await Promise.all([
    Tenant.find(filter).sort(sort).skip(pagination.skip).limit(pagination.limit),
    Tenant.countDocuments(filter),
  ]);
  return { tenants, meta: buildPaginationMeta(total, pagination.page, pagination.limit) };
}

export async function updateTenantStatus(tenantId: string, status: AccountStatus) {
  const tenant = await Tenant.findByIdAndUpdate(tenantId, { status }, { new: true });
  if (!tenant) {
    throw new NotFoundError('Tenant not found');
  }
  return tenant;
}

export async function updateTenant(tenantId: string, input: UpdateTenantInput) {
  const { businessMobileNumber, ...rest } = input;
  const update: Record<string, unknown> = { ...rest };
  if (businessMobileNumber !== undefined) {
    update.mobileNumber = businessMobileNumber;
  }

  const tenant = await Tenant.findByIdAndUpdate(tenantId, update, { new: true });
  if (!tenant) {
    throw new NotFoundError('Tenant not found');
  }
  return tenant;
}
