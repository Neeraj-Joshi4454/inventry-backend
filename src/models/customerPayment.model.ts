import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { PaymentMethod } from '../types/enums';
import { applyDecimalToJson } from '../utils/schemaJson';

// The permanent ledger of money actually received against a Sale — never
// updated or deleted once created (see customerPayment.service.ts). A
// Sale's own paidAmount/dueAmount/paymentStatus are a cached running total
// kept in sync with this collection in the same transaction each payment
// is recorded in, the same "ledger entry + cached total" shape
// inventory.service.ts uses for stock.
const customerPaymentSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, immutable: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, immutable: true },
    saleId: { type: Schema.Types.ObjectId, ref: 'Sale', required: true, immutable: true },
    amount: { type: Schema.Types.Decimal128, required: true },
    method: { type: String, enum: Object.values(PaymentMethod), required: true },
    paymentDate: { type: Date, required: true, default: Date.now },
    notes: { type: String, trim: true },
    recordedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

customerPaymentSchema.index({ tenantId: 1, saleId: 1 });
customerPaymentSchema.index({ tenantId: 1, customerId: 1, paymentDate: -1 });
customerPaymentSchema.index({ tenantId: 1, paymentDate: -1 });
applyDecimalToJson(customerPaymentSchema);

export type CustomerPaymentDocument = InferSchemaType<typeof customerPaymentSchema> & {
  _id: Types.ObjectId;
};

export const CustomerPayment = model('CustomerPayment', customerPaymentSchema);
