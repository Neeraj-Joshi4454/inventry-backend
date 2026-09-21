import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { InventoryTransactionType, ReferenceType } from '../types/enums';

// Append-only ledger. Never updated or deleted after creation — this is the
// audit trail that currentStock is reconstructible from.
const inventoryTransactionSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, immutable: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, immutable: true },
    inventoryId: { type: Schema.Types.ObjectId, ref: 'Inventory', required: true, immutable: true },
    type: { type: String, enum: Object.values(InventoryTransactionType), required: true },
    quantity: { type: Number, required: true, min: 0 }, // always positive; direction derived from `type`
    previousStock: { type: Number, required: true, min: 0 },
    resultingStock: { type: Number, required: true, min: 0 },
    referenceType: { type: String, enum: Object.values(ReferenceType), required: true },
    referenceId: { type: Schema.Types.ObjectId, required: true },
    performedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // Distinct from `notes` — populated only for STOCK_ADJUSTMENT_IN/OUT,
    // where "why" (damaged, miscount, ...) is a required, structured field
    // in the UI rather than free text.
    reason: { type: String, trim: true },
    notes: { type: String, trim: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

inventoryTransactionSchema.index({ tenantId: 1, productId: 1, createdAt: -1 });
inventoryTransactionSchema.index({ tenantId: 1, referenceType: 1, referenceId: 1 });

export type InventoryTransactionDocument = InferSchemaType<typeof inventoryTransactionSchema> & {
  _id: Types.ObjectId;
};

export const InventoryTransaction = model('InventoryTransaction', inventoryTransactionSchema);
