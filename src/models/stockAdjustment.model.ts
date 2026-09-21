import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { InventoryTransactionType } from '../types/enums';

const stockAdjustmentSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, immutable: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    type: {
      type: String,
      enum: [
        InventoryTransactionType.STOCK_ADJUSTMENT_IN,
        InventoryTransactionType.STOCK_ADJUSTMENT_OUT,
      ],
      required: true,
    },
    quantity: { type: Number, required: true, min: 0.001 },
    reason: { type: String, required: true, trim: true },
    performedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

stockAdjustmentSchema.index({ tenantId: 1, productId: 1, createdAt: -1 });

export type StockAdjustmentDocument = InferSchemaType<typeof stockAdjustmentSchema> & {
  _id: Types.ObjectId;
};

export const StockAdjustment = model('StockAdjustment', stockAdjustmentSchema);
