import type { Types } from 'mongoose';
import { BusinessBranding } from '../../models/businessBranding.model';
import { AuditAction } from '../../constants/auditActions';
import { BadRequestError, NotFoundError } from '../../utils/errors';
import { recordAuditLog } from '../auditLogs/auditLog.service';
import type { UserRole } from '../../types/enums';
import {
  ALLOWED_IMAGE_TYPES,
  BRANDING_IMAGE_KINDS,
  MAX_IMAGE_BYTES,
  type BankDetailsInput,
  type BrandingImageKind,
} from './branding.validators';

type Actor = {
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  userRole: UserRole;
  ipAddress?: string;
};

/**
 * What this business has set, without image bytes — the app compares each
 * image's updatedAt with its local copy and only downloads what changed.
 */
export async function getBranding(tenantId: Types.ObjectId) {
  const branding = await BusinessBranding.findOne({ tenantId }).select(
    '-upiQr.data -businessLogo.data'
  );
  const image = (value?: { contentType: string; updatedAt: Date } | null) =>
    value ? { contentType: value.contentType, updatedAt: value.updatedAt } : null;
  const bank = branding?.bankDetails;
  return {
    upiQr: image(branding?.upiQr),
    businessLogo: image(branding?.businessLogo),
    bankDetails: bank
      ? {
          accountHolderName: bank.accountHolderName,
          bankName: bank.bankName,
          accountNumber: bank.accountNumber,
          ifsc: bank.ifsc,
          branch: bank.branch ?? undefined,
          updatedAt: bank.updatedAt,
        }
      : null,
  };
}

export async function getBrandingImage(tenantId: Types.ObjectId, kind: BrandingImageKind) {
  const field = BRANDING_IMAGE_KINDS[kind];
  const branding = await BusinessBranding.findOne({ tenantId }).select(field);
  const image = branding?.[field];
  if (!image) {
    throw new NotFoundError('Image not found');
  }
  return image;
}

export async function saveBrandingImage(
  actor: Actor,
  kind: BrandingImageKind,
  contentType: string | undefined,
  data: unknown
) {
  const type = contentType?.split(';')[0]?.trim().toLowerCase();
  if (!type || !ALLOWED_IMAGE_TYPES.includes(type)) {
    throw new BadRequestError('Upload a PNG, JPEG, WebP or GIF image');
  }
  if (!Buffer.isBuffer(data) || data.length === 0) {
    throw new BadRequestError('Image is empty');
  }
  if (data.length > MAX_IMAGE_BYTES) {
    throw new BadRequestError('Image is too large (max 3 MB)');
  }

  const field = BRANDING_IMAGE_KINDS[kind];
  const updatedAt = new Date();
  const branding = await BusinessBranding.findOneAndUpdate(
    { tenantId: actor.tenantId },
    { $set: { [field]: { data, contentType: type, updatedAt } } },
    { upsert: true, new: true, projection: { _id: 1 } }
  );
  await audit(actor, branding._id, { [field]: 'updated' });
  return { contentType: type, updatedAt };
}

export async function removeBrandingImage(actor: Actor, kind: BrandingImageKind) {
  const field = BRANDING_IMAGE_KINDS[kind];
  const branding = await BusinessBranding.findOneAndUpdate(
    { tenantId: actor.tenantId },
    { $unset: { [field]: 1 } },
    { projection: { _id: 1 } }
  );
  if (branding) await audit(actor, branding._id, { [field]: 'removed' });
}

export async function saveBankDetails(actor: Actor, input: BankDetailsInput) {
  const bankDetails = { ...input, updatedAt: new Date() };
  const branding = await BusinessBranding.findOneAndUpdate(
    { tenantId: actor.tenantId },
    { $set: { bankDetails } },
    { upsert: true, new: true, projection: { _id: 1 } }
  );
  await audit(actor, branding._id, { bankDetails: 'updated' });
  return bankDetails;
}

export async function removeBankDetails(actor: Actor) {
  const branding = await BusinessBranding.findOneAndUpdate(
    { tenantId: actor.tenantId },
    { $unset: { bankDetails: 1 } },
    { projection: { _id: 1 } }
  );
  if (branding) await audit(actor, branding._id, { bankDetails: 'removed' });
}

function audit(actor: Actor, entityId: Types.ObjectId, after: Record<string, string>) {
  return recordAuditLog({
    tenantId: actor.tenantId,
    actorId: actor.userId,
    actorRole: actor.userRole,
    action: AuditAction.BUSINESS_BRANDING_UPDATED,
    entityType: 'BusinessBranding',
    entityId,
    changes: { after },
    ipAddress: actor.ipAddress,
  });
}
