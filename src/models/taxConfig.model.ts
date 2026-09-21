import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { TaxType } from '../types/enums';

// One document per tenant (enforced by the unique index below) — the
// tenant's GST registration and default rate/regime. Sales/Purchases never
// read this at display time for a historical document: every tax amount
// and rate actually used is persisted on the Sale/Purchase/Return itself
// at creation, so changing this config later never rewrites history (see
// "Important Rules": historical invoices must not change).
const taxConfigSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      immutable: true,
      unique: true,
    },
    gstEnabled: { type: Boolean, default: true },
    gstin: { type: String, trim: true, uppercase: true },
    state: { type: String, trim: true },
    defaultTaxRate: { type: Number, default: 0 },
    taxType: {
      type: String,
      enum: Object.values(TaxType),
      default: TaxType.CGST_SGST,
    },
  },
  { timestamps: true }
);

export type TaxConfigDocument = InferSchemaType<typeof taxConfigSchema> & { _id: Types.ObjectId };

export const TaxConfig = model('TaxConfig', taxConfigSchema);
