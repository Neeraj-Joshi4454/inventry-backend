import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { DocumentStatus, PaymentMethod, PaymentStatus, TaxType } from '../types/enums';
import { applyDecimalToJson } from '../utils/schemaJson';

const purchaseSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, immutable: true },
    purchaseNumber: { type: String, required: true, trim: true },
    // The supplier's own bill/invoice number — distinct from purchaseNumber
    // (our internal PO-xxxxxx sequence, see nextPurchaseNumber). Optional:
    // not every supplier hands over a numbered invoice at time of delivery.
    invoiceNumber: { type: String, trim: true },
    supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier', required: true },
    purchaseDate: { type: Date, required: true, default: Date.now },
    status: {
      type: String,
      enum: Object.values(DocumentStatus),
      default: DocumentStatus.CONFIRMED,
    },
    subTotal: { type: Schema.Types.Decimal128, required: true },
    // Previously accepted from the request and folded into totalAmount but
    // never actually persisted — fixed alongside adding tax support, since
    // "Taxable amount" now needs a real, stored discount to subtract.
    discountAmount: { type: Schema.Types.Decimal128, required: true, default: 0 },
    taxableAmount: { type: Schema.Types.Decimal128, required: true, default: 0 },
    cgstAmount: { type: Schema.Types.Decimal128, required: true, default: 0 },
    sgstAmount: { type: Schema.Types.Decimal128, required: true, default: 0 },
    igstAmount: { type: Schema.Types.Decimal128, required: true, default: 0 },
    taxAmount: { type: Schema.Types.Decimal128, required: true, default: 0 },
    taxType: { type: String, enum: Object.values(TaxType), default: TaxType.NO_TAX },
    totalAmount: { type: Schema.Types.Decimal128, required: true },
    paidAmount: { type: Schema.Types.Decimal128, required: true, default: 0 },
    dueAmount: { type: Schema.Types.Decimal128, required: true, default: 0 },
    paymentStatus: {
      type: String,
      enum: Object.values(PaymentStatus),
      default: PaymentStatus.UNPAID,
    },
    // How the amount paid at purchase time was paid (CREDIT when nothing
    // was paid), plus its transaction reference — mirrors Sale.
    paymentMethod: { type: String, enum: Object.values(PaymentMethod) },
    paymentReference: { type: String, trim: true },
    notes: { type: String, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

purchaseSchema.index({ tenantId: 1, purchaseNumber: 1 }, { unique: true });
purchaseSchema.index({ tenantId: 1, purchaseDate: -1 });
purchaseSchema.index({ tenantId: 1, supplierId: 1 });
// Not unique — different suppliers can legitimately issue the same invoice
// number, and it's optional besides. Indexed purely to make "find this
// purchase by the supplier's invoice number" (a natural admin/search need)
// fast.
purchaseSchema.index({ tenantId: 1, invoiceNumber: 1 });
applyDecimalToJson(purchaseSchema);

const purchaseItemSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, immutable: true },
    purchaseId: { type: Schema.Types.ObjectId, ref: 'Purchase', required: true, immutable: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: { type: Number, required: true, min: 0.001 },
    // Always tax-exclusive — see sale.model.ts::saleItemSchema's identical
    // comment, and taxCalculation.service.ts.
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

purchaseItemSchema.index({ tenantId: 1, purchaseId: 1 });
purchaseItemSchema.index({ tenantId: 1, productId: 1 });
applyDecimalToJson(purchaseItemSchema);

export type PurchaseDocument = InferSchemaType<typeof purchaseSchema> & { _id: Types.ObjectId };
export type PurchaseItemDocument = InferSchemaType<typeof purchaseItemSchema> & {
  _id: Types.ObjectId;
};

export const Purchase = model('Purchase', purchaseSchema);
export const PurchaseItem = model('PurchaseItem', purchaseItemSchema);
