import type { Types } from 'mongoose';
import { Tenant } from '../../models/tenant.model';
import { NotFoundError } from '../../utils/errors';
import { updateTenant } from '../tenants/tenant.service';
import type { UpdateTenantInput } from '../tenants/tenant.validators';

/**
 * Owner-facing "Business Settings" — thin wrapper around the existing
 * Tenant read/update (tenant.service.ts::updateTenant), scoped to the
 * caller's own tenant rather than an arbitrary tenantId. Never duplicates
 * the update logic itself, just how the tenant id is sourced.
 */
export async function getBusinessSettings(tenantId: Types.ObjectId) {
  const tenant = await Tenant.findById(tenantId);
  if (!tenant) {
    throw new NotFoundError('Business not found');
  }
  return tenant;
}

export async function updateBusinessSettings(tenantId: Types.ObjectId, input: UpdateTenantInput) {
  return updateTenant(tenantId.toString(), input);
}
