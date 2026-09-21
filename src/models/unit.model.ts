import { Schema, model, type InferSchemaType, type Types } from 'mongoose';

const unitSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, immutable: true },
    name: { type: String, required: true, trim: true }, // e.g. "Bag", "Ton", "Cubic Meter"
    symbol: { type: String, required: true, trim: true }, // e.g. "bag", "t", "m3"
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

unitSchema.index({ tenantId: 1, name: 1 }, { unique: true });

export type UnitDocument = InferSchemaType<typeof unitSchema> & { _id: Types.ObjectId };

export const Unit = model('Unit', unitSchema);
