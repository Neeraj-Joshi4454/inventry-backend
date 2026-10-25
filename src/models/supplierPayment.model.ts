import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { PaymentMethod } from '../types/enums';
import { applyDecimalToJson } from '../utils/schemaJson';

// The permanent ledger of money actually paid to a supplier against a
// Purchase — the mirror image of customerPayment.model.ts. A Purchase's own
// paidAmount/dueAmount/paymentStatus are a cached running total kept in
// sync with this collection in the same transaction each payment is
// recorded in (see supplierPayment.service.ts).
const supplierPaymentSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, immutable: true },
    supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier', required: true, immutable: true },
    purchaseId: { type: Schema.Types.ObjectId, ref: 'Purchase', required: true, immutable: true },
    amount: { type: Schema.Types.Decimal128, required: true },
    method: { type: String, enum: Object.values(PaymentMethod), required: true },
    paymentDate: { type: Date, required: true, default: Date.now },
    // UPI transaction id, bank/UTR reference, cheque number, etc.
    referenceNumber: { type: String, trim: true },
    notes: { type: String, trim: true },
    recordedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

supplierPaymentSchema.index({ tenantId: 1, purchaseId: 1 });
supplierPaymentSchema.index({ tenantId: 1, supplierId: 1, paymentDate: -1 });
supplierPaymentSchema.index({ tenantId: 1, paymentDate: -1 });
applyDecimalToJson(supplierPaymentSchema);

export type SupplierPaymentDocument = InferSchemaType<typeof supplierPaymentSchema> & {
  _id: Types.ObjectId;
};

export const SupplierPayment = model('SupplierPayment', supplierPaymentSchema);
