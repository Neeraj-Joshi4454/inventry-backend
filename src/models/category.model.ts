import { Schema, model, type InferSchemaType, type Types } from 'mongoose';

const categorySchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, immutable: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

categorySchema.index({ tenantId: 1, name: 1 }, { unique: true });

export type CategoryDocument = InferSchemaType<typeof categorySchema> & { _id: Types.ObjectId };

export const Category = model('Category', categorySchema);
