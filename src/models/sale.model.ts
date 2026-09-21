import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { DocumentStatus, PaymentMethod, PaymentStatus, TaxType } from '../types/enums';
import { applyDecimalToJson } from '../utils/schemaJson';

const saleSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, immutable: true },
    saleNumber: { type: String, required: true, trim: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    saleDate: { type: Date, required: true, default: Date.now },
    status: {
      type: String,
      enum: Object.values(DocumentStatus),
      default: DocumentStatus.CONFIRMED,
    },
    subTotal: { type: Schema.Types.Decimal128, required: true },
    discountAmount: { type: Schema.Types.Decimal128, required: true, default: 0 },
    // taxableAmount = subTotal - discountAmount — GST is always computed on
    // this, never on subTotal directly (see taxCalculation.service.ts).
    taxableAmount: { type: Schema.Types.Decimal128, required: true, default: 0 },
    cgstAmount: { type: Schema.Types.Decimal128, required: true, default: 0 },
    sgstAmount: { type: Schema.Types.Decimal128, required: true, default: 0 },
    igstAmount: { type: Schema.Types.Decimal128, required: true, default: 0 },
    // Sum of cgst+sgst+igst — kept as its own stored field (not a computed
    // getter) so every historical sale keeps the exact tax amount it was
    // created with even if tax settings change later.
    taxAmount: { type: Schema.Types.Decimal128, required: true, default: 0 },
    // Which GST regime was actually applied to this sale, resolved once at
    // creation time from business-state vs customer-state (or NO_TAX if
    // GST was disabled) — never re-derived from today's tax config.
    taxType: { type: String, enum: Object.values(TaxType), default: TaxType.NO_TAX },
    totalAmount: { type: Schema.Types.Decimal128, required: true },
    paidAmount: { type: Schema.Types.Decimal128, required: true, default: 0 },
    dueAmount: { type: Schema.Types.Decimal128, required: true, default: 0 },
    paymentStatus: {
      type: String,
      enum: Object.values(PaymentStatus),
      default: PaymentStatus.CREDIT,
    },
    // How the customer said they'd pay at sale time — set once at creation,
    // separate from the CustomerPayment ledger (customerPayment.model.ts),
    // which records money actually received, possibly across several
    // payments each with their own method.
    paymentMethod: { type: String, enum: Object.values(PaymentMethod) },
    notes: { type: String, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

saleSchema.index({ tenantId: 1, saleNumber: 1 }, { unique: true });
saleSchema.index({ tenantId: 1, saleDate: -1 });
saleSchema.index({ tenantId: 1, customerId: 1 });
applyDecimalToJson(saleSchema);

const saleItemSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, immutable: true },
    saleId: { type: Schema.Types.ObjectId, ref: 'Sale', required: true, immutable: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: { type: Number, required: true, min: 0.001 },
    // Always tax-exclusive, even when the line was entered as tax-inclusive
    // — see taxCalculation.service.ts, which backs the inclusive price out
    // to this exclusive base before anything else is computed/stored.
    unitPrice: { type: Schema.Types.Decimal128, required: true },
    taxRate: { type: Number, default: 0 },
    isPriceInclusive: { type: Boolean, default: false },
    discountAmount: { type: Schema.Types.Decimal128, required: true, default: 0 },
    taxableAmount: { type: Schema.Types.Decimal128, required: true, default: 0 },
    cgstAmount: { type: Schema.Types.Decimal128, required: true, default: 0 },
    sgstAmount: { type: Schema.Types.Decimal128, required: true, default: 0 },
    igstAmount: { type: Schema.Types.Decimal128, required: true, default: 0 },
    lineTotal: { type: Schema.Types.Decimal128, required: true },
  },
  { timestamps: true }
);

saleItemSchema.index({ tenantId: 1, saleId: 1 });
saleItemSchema.index({ tenantId: 1, productId: 1 });
applyDecimalToJson(saleItemSchema);

export type SaleDocument = InferSchemaType<typeof saleSchema> & { _id: Types.ObjectId };
export type SaleItemDocument = InferSchemaType<typeof saleItemSchema> & { _id: Types.ObjectId };

export const Sale = model('Sale', saleSchema);
export const SaleItem = model('SaleItem', saleItemSchema);
