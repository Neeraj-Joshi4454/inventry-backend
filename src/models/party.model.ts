import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { applyDecimalToJson } from '../utils/schemaJson';

// Customer and Supplier share an identical shape, so the schema is defined
// once and used to create two distinct models/collections.
function buildPartySchema() {
  return new Schema(
    {
      tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, immutable: true },
      name: { type: String, required: true, trim: true },
      // Supplier-oriented (the person to call at that business), but kept on
      // the shared schema rather than forked out for one party type — see
      // the comment above buildPartySchema.
      contactPerson: { type: String, trim: true },
      mobileNumber: { type: String, trim: true },
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
      notes: { type: String, trim: true },
      openingBalance: { type: Schema.Types.Decimal128, default: 0 },
      currentBalance: { type: Schema.Types.Decimal128, default: 0 },
      isActive: { type: Boolean, default: true },
    },
    { timestamps: true }
  );
}

const customerSchema = buildPartySchema();
customerSchema.index({ tenantId: 1, name: 1 });
customerSchema.index({ tenantId: 1, mobileNumber: 1 });
applyDecimalToJson(customerSchema);

const supplierSchema = buildPartySchema();
supplierSchema.index({ tenantId: 1, name: 1 });
supplierSchema.index({ tenantId: 1, mobileNumber: 1 });
applyDecimalToJson(supplierSchema);

export type CustomerDocument = InferSchemaType<typeof customerSchema> & { _id: Types.ObjectId };
export type SupplierDocument = InferSchemaType<typeof supplierSchema> & { _id: Types.ObjectId };

export const Customer = model('Customer', customerSchema);
export const Supplier = model('Supplier', supplierSchema);
