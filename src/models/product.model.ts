import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { applyDecimalToJson } from '../utils/schemaJson';

const productSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, immutable: true },
    name: { type: String, required: true, trim: true },
    sku: { type: String, required: true, trim: true, uppercase: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
    unitId: { type: Schema.Types.ObjectId, ref: 'Unit', required: true },
    description: { type: String, trim: true },
    purchasePrice: { type: Schema.Types.Decimal128, required: true },
    sellingPrice: { type: Schema.Types.Decimal128, required: true },
    lowStockThreshold: { type: Number, required: true, default: 0, min: 0 },
    hsnCode: { type: String, trim: true },
    // Default GST rate applied to a sale/purchase line for this product
    // when the line doesn't specify its own taxRate — see
    // taxCalculation.service.ts. Missing on any product created before
    // this field existed, which InferSchemaType/Mongoose's default: 0
    // already handles transparently (reads back as 0, same as "no tax").
    taxRate: { type: Number, default: 0 },
    // Whether sellingPrice/purchasePrice already include tax. Existing
    // products default to false (tax-exclusive), preserving exactly how
    // every price on this system has always been interpreted.
    isPriceInclusive: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

productSchema.index({ tenantId: 1, sku: 1 }, { unique: true });
productSchema.index({ tenantId: 1, categoryId: 1 });
productSchema.index({ tenantId: 1, isActive: 1 });
productSchema.index({ tenantId: 1, name: 'text' });
applyDecimalToJson(productSchema);

export type ProductDocument = InferSchemaType<typeof productSchema> & { _id: Types.ObjectId };

export const Product = model('Product', productSchema);
