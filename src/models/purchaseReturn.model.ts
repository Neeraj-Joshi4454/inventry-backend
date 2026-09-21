import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { TaxType } from '../types/enums';
import { applyDecimalToJson } from '../utils/schemaJson';

// Mirrors saleReturn.model.ts exactly, for the supplier-facing direction —
// see that file's comment for why returns are their own immutable
// documents rather than mutations of the original Purchase/PurchaseItem.
const purchaseReturnSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, immutable: true },
    purchaseId: { type: Schema.Types.ObjectId, ref: 'Purchase', required: true, immutable: true },
    returnNumber: { type: String, required: true, trim: true },
    returnDate: { type: Date, required: true, default: Date.now },
    // Proportionally reversed from the ORIGINAL PurchaseItem's persisted
    // rate/split — see purchaseReturn.service.ts::createPurchaseReturn and
    // the identical comment on saleReturn.model.ts.
    taxableAmount: { type: Schema.Types.Decimal128, required: true, default: 0 },
    cgstAmount: { type: Schema.Types.Decimal128, required: true, default: 0 },
    sgstAmount: { type: Schema.Types.Decimal128, required: true, default: 0 },
    igstAmount: { type: Schema.Types.Decimal128, required: true, default: 0 },
    taxAmount: { type: Schema.Types.Decimal128, required: true, default: 0 },
    taxType: { type: String, enum: Object.values(TaxType), default: TaxType.NO_TAX },
    totalAmount: { type: Schema.Types.Decimal128, required: true },
    notes: { type: String, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

purchaseReturnSchema.index({ tenantId: 1, returnNumber: 1 }, { unique: true });
purchaseReturnSchema.index({ tenantId: 1, purchaseId: 1 });
applyDecimalToJson(purchaseReturnSchema);

const purchaseReturnItemSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, immutable: true },
    purchaseReturnId: {
      type: Schema.Types.ObjectId,
      ref: 'PurchaseReturn',
      required: true,
      immutable: true,
    },
    purchaseId: { type: Schema.Types.ObjectId, ref: 'Purchase', required: true, immutable: true },
    purchaseItemId: {
      type: Schema.Types.ObjectId,
      ref: 'PurchaseItem',
      required: true,
      immutable: true,
    },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: { type: Number, required: true, min: 0.001 },
    unitPrice: { type: Schema.Types.Decimal128, required: true },
    taxRate: { type: Number, default: 0 },
    taxableAmount: { type: Schema.Types.Decimal128, required: true, default: 0 },
    cgstAmount: { type: Schema.Types.Decimal128, required: true, default: 0 },
    sgstAmount: { type: Schema.Types.Decimal128, required: true, default: 0 },
    igstAmount: { type: Schema.Types.Decimal128, required: true, default: 0 },
    lineTotal: { type: Schema.Types.Decimal128, required: true },
  },
  { timestamps: true }
);

purchaseReturnItemSchema.index({ tenantId: 1, purchaseReturnId: 1 });
purchaseReturnItemSchema.index({ tenantId: 1, purchaseItemId: 1 });
applyDecimalToJson(purchaseReturnItemSchema);

export type PurchaseReturnDocument = InferSchemaType<typeof purchaseReturnSchema> & {
  _id: Types.ObjectId;
};
export type PurchaseReturnItemDocument = InferSchemaType<typeof purchaseReturnItemSchema> & {
  _id: Types.ObjectId;
};

export const PurchaseReturn = model('PurchaseReturn', purchaseReturnSchema);
export const PurchaseReturnItem = model('PurchaseReturnItem', purchaseReturnItemSchema);
