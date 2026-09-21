import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { AccountStatus, UserRole } from '../types/enums';

const userSchema = new Schema(
  {
    // null only for SUPER_ADMIN; required for every other role.
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', default: null, immutable: true },
    name: { type: String, required: true, trim: true },
    // Global login identifier (see architecture decision: uniqueness is global,
    // not per-tenant, to keep login simple with no tenant-selection step).
    mobileNumber: { type: String, required: true, unique: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: Object.values(UserRole), required: true, index: true },
    status: {
      type: String,
      enum: Object.values(AccountStatus),
      default: AccountStatus.ACTIVE,
      index: true,
    },
    mustChangePassword: { type: Boolean, default: true },
    lastLoginAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

userSchema.index({ tenantId: 1, role: 1 });

userSchema.pre('validate', function (next) {
  if (this.role !== UserRole.SUPER_ADMIN && !this.tenantId) {
    next(new Error('tenantId is required for all roles except SUPER_ADMIN'));
    return;
  }
  if (this.role === UserRole.SUPER_ADMIN && this.tenantId) {
    next(new Error('SUPER_ADMIN users must not have a tenantId'));
    return;
  }
  next();
});

export type UserDocument = InferSchemaType<typeof userSchema> & { _id: Types.ObjectId };

export const User = model('User', userSchema);
