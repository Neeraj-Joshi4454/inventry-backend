import { Schema, model, type InferSchemaType, type Types } from 'mongoose';

// Distinct from product Category (category.model.ts) — expense categories
// classify business spend (Rent, Electricity, ...), not catalog items, and
// need an isSystem flag the product-category model doesn't: the default
// set seeded at tenant creation (see constants/seedData.ts) must not be
// accidentally deactivated (see expenseCategory.service.ts).
const expenseCategorySchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, immutable: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    isSystem: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

expenseCategorySchema.index({ tenantId: 1, name: 1 }, { unique: true });

export type ExpenseCategoryDocument = InferSchemaType<typeof expenseCategorySchema> & {
  _id: Types.ObjectId;
};

export const ExpenseCategory = model('ExpenseCategory', expenseCategorySchema);
