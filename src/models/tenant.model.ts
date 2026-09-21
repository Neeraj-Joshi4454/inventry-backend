import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { AccountStatus } from '../types/enums';

const tenantSchema = new Schema(
  {
    businessName: { type: String, required: true, trim: true },
    businessType: { type: String, default: 'CIVIL_CONSTRUCTION_MATERIAL' },
    ownerName: { type: String, required: true, trim: true },
    mobileNumber: { type: String, required: true, unique: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    address: {
      line1: String,
      line2: String,
      city: String,
      state: String,
      pincode: String,
      country: { type: String, default: 'IN' },
    },
    gstNumber: { type: String, trim: true },
    // Cosmetic only — displayed on the printed invoice (see
    // sale.service.ts::getSaleInvoiceData). Does NOT change saleNumber
    // generation (still "SL-000001", see sale.service.ts::nextSaleNumber);
    // repurposing that as a live business setting would risk breaking the
    // uniqueness/sequencing an existing tenant's sale numbers depend on.
    invoicePrefix: { type: String, trim: true, default: 'INV' },
    invoiceFooterNote: { type: String, trim: true },
    status: {
      type: String,
      enum: Object.values(AccountStatus),
      default: AccountStatus.ACTIVE,
      index: true,
    },
    plan: { type: String, enum: ['FREE', 'BASIC', 'PRO'], default: 'FREE' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

export type TenantDocument = InferSchemaType<typeof tenantSchema> & { _id: Types.ObjectId };

export const Tenant = model('Tenant', tenantSchema);
