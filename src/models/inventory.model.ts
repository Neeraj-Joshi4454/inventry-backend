import { Schema, model, type InferSchemaType, type Types } from 'mongoose';

// One document per (tenant, product) — the current-state record.
// NEVER mutate currentStock directly from a controller; always go through
// inventory.service.ts, which performs the atomic guarded update.
const inventorySchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, immutable: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, immutable: true },
    currentStock: { type: Number, required: true, default: 0, min: 0 },
    reservedStock: { type: Number, required: true, default: 0, min: 0 },
    lastTransactionId: { type: Schema.Types.ObjectId, ref: 'InventoryTransaction' },
    version: { type: Number, required: true, default: 0 },
  },
  { timestamps: true }
);

inventorySchema.index({ tenantId: 1, productId: 1 }, { unique: true });

export type InventoryDocument = InferSchemaType<typeof inventorySchema> & { _id: Types.ObjectId };

export const Inventory = model('Inventory', inventorySchema);
