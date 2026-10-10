import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { TaxType } from '../types/enums';
import { applyDecimalToJson } from '../utils/schemaJson';

// A return is its own immutable document, never a mutation of the original
// Sale/SaleItem — the original sale record stays exactly as it was sold;
// "how much has been returned so far" is derived by summing SaleReturnItem
// rows for a given saleItemId (see saleReturn.service.ts).
const saleReturnSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, immutable: true },
    saleId: { type: Schema.Types.ObjectId, ref: 'Sale', required: true, immutable: true },
    returnNumber: { type: String, required: true, trim: true },
    returnDate: { type: Date, required: true, default: Date.now },
    // The amounts here are proportionally reversed from the ORIGINAL
    // SaleItem's already-persisted rate/split (see
    // saleReturn.service.ts::createSaleReturn) — never recomputed from
    // today's tax config, so a return's tax always matches what was
    // actually charged on the sale it's reversing.
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

saleReturnSchema.index({ tenantId: 1, returnNumber: 1 }, { unique: true });
saleReturnSchema.index({ tenantId: 1, saleId: 1 });
applyDecimalToJson(saleReturnSchema);

const saleReturnItemSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, immutable: true },
    saleReturnId: {
      type: Schema.Types.ObjectId,
      ref: 'SaleReturn',
      required: true,
      immutable: true,
    },
    // Denormalized off the parent SaleReturn so "how much of this line has
    // been returned across all returns" can be aggregated directly against
    // this collection without a join.
    saleId: { type: Schema.Types.ObjectId, ref: 'Sale', required: true, immutable: true },
    saleItemId: { type: Schema.Types.ObjectId, ref: 'SaleItem', required: true, immutable: true },
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

saleReturnItemSchema.index({ tenantId: 1, saleReturnId: 1 });
saleReturnItemSchema.index({ tenantId: 1, saleItemId: 1 });
applyDecimalToJson(saleReturnItemSchema);

export type SaleReturnDocument = InferSchemaType<typeof saleReturnSchema> & { _id: Types.ObjectId };
export type SaleReturnItemDocument = InferSchemaType<typeof saleReturnItemSchema> & {
  _id: Types.ObjectId;
};

export const SaleReturn = model('SaleReturn', saleReturnSchema);
export const SaleReturnItem = model('SaleReturnItem', saleReturnItemSchema);
