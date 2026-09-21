import type { Types } from 'mongoose';
import { TaxConfig } from '../../models/taxConfig.model';
import { TaxType } from '../../types/enums';
import { AuditAction } from '../../constants/auditActions';
import { BadRequestError } from '../../utils/errors';
import { recordAuditLog } from '../auditLogs/auditLog.service';
import type { UserRole } from '../../types/enums';
import type { UpdateTaxConfigInput } from './tax.validators';

/**
 * The config an un-configured tenant behaves as. GST stays "enabled" by
 * default (matching how a line/product taxRate has always worked in this
 * system, before Tax Settings existed) — a rate of 0 on a line/product
 * already produces zero tax, so nothing changes for a tenant that never
 * touches Tax Settings at all. Disabling GST is an explicit opt-out via
 * PATCH /api/v1/taxes, not the unconfigured default.
 */
const DEFAULT_TAX_CONFIG = {
  gstEnabled: true,
  gstin: undefined as string | undefined,
  state: undefined as string | undefined,
  defaultTaxRate: 0,
  taxType: TaxType.CGST_SGST as string,
};

/**
 * Read-only shape used internally by sale.service.ts/purchase.service.ts
 * (via resolveTaxSplit) — never null, so callers don't need an "is this
 * tenant configured yet" branch. A tenant with no TaxConfig row at all
 * (never visited /taxes, or created before this feature existed) behaves
 * exactly as if GST were disabled — no retroactive tax on old data.
 */
export async function getEffectiveTaxConfig(tenantId: Types.ObjectId) {
  const config = await TaxConfig.findOne({ tenantId });
  if (!config) return DEFAULT_TAX_CONFIG;
  return {
    gstEnabled: config.gstEnabled,
    gstin: config.gstin,
    state: config.state,
    defaultTaxRate: config.defaultTaxRate,
    taxType: config.taxType,
  };
}

/** GET /api/v1/taxes — same defaults as getEffectiveTaxConfig, but as a full response shape. */
export async function getTaxConfig(tenantId: Types.ObjectId) {
  const config = await TaxConfig.findOne({ tenantId });
  if (!config) return { tenantId, ...DEFAULT_TAX_CONFIG };
  return config;
}

export async function updateTaxConfig(params: {
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  userRole: UserRole;
  input: UpdateTaxConfigInput;
  ipAddress?: string;
}) {
  const { tenantId, userId, userRole, input, ipAddress } = params;

  let config = await TaxConfig.findOne({ tenantId });
  const merged = {
    gstEnabled: input.gstEnabled ?? config?.gstEnabled ?? DEFAULT_TAX_CONFIG.gstEnabled,
    gstin: input.gstin ?? config?.gstin ?? DEFAULT_TAX_CONFIG.gstin,
  };
  if (merged.gstEnabled && !merged.gstin) {
    throw new BadRequestError('GSTIN is required when GST is enabled');
  }

  if (!config) {
    config = new TaxConfig({ tenantId });
  }
  Object.assign(config, input);
  await config.save();

  await recordAuditLog({
    tenantId,
    actorId: userId,
    actorRole: userRole,
    action: AuditAction.TAX_CONFIG_UPDATED,
    entityType: 'TaxConfig',
    entityId: config._id,
    changes: { after: input },
    ipAddress,
  });

  return config;
}
