import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { ExpensePaymentMethod, ExpenseStatus } from '../types/enums';
import { applyDecimalToJson } from '../utils/schemaJson';

const expenseSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, immutable: true },
    title: { type: String, required: true, trim: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'ExpenseCategory', required: true },
    amount: { type: Schema.Types.Decimal128, required: true },
    expenseDate: { type: Date, required: true, default: Date.now },
    paymentMethod: { type: String, enum: Object.values(ExpensePaymentMethod), required: true },
    referenceNumber: { type: String, trim: true },
    notes: { type: String, trim: true },
    // No file-upload pipeline exists in this backend yet — this stores a
    // URL to a receipt hosted elsewhere (e.g. a client-side upload to
    // cloud storage), not a raw file. Adding real upload handling is a
    // separate, larger feature.
    attachmentUrl: { type: String, trim: true },
    // Soft-deletion only — see ExpenseStatus in types/enums.ts and
    // "Important Rules": financial records are never physically deleted.
    status: {
      type: String,
      enum: Object.values(ExpenseStatus),
      default: ExpenseStatus.ACTIVE,
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

expenseSchema.index({ tenantId: 1, expenseDate: -1 });
expenseSchema.index({ tenantId: 1, categoryId: 1 });
expenseSchema.index({ tenantId: 1, paymentMethod: 1 });
expenseSchema.index({ tenantId: 1, status: 1 });
applyDecimalToJson(expenseSchema);

export type ExpenseDocument = InferSchemaType<typeof expenseSchema> & { _id: Types.ObjectId };

export const Expense = model('Expense', expenseSchema);
