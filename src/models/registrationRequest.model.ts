import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { RegistrationStatus } from '../types/enums';

/**
 * A business that signed itself up from the mobile app's Register screen
 * and is waiting for a Super Admin to review it. Holds exactly what the
 * admin panel's "New Business" form collects; nothing is created in
 * Tenant/User until the request is approved
 * (registration.service.ts::approveRegistration).
 */
const registrationRequestSchema = new Schema(
  {
    businessName: { type: String, required: true, trim: true },
    ownerName: { type: String, required: true, trim: true },
    // Both the business's contact number and the owner's login.
    mobileNumber: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    // Hashed at submit time — the plain password is never stored, and
    // becomes the owner's password on approval.
    passwordHash: { type: String, required: true, select: false },
    status: {
      type: String,
      enum: Object.values(RegistrationStatus),
      default: RegistrationStatus.PENDING,
    },
    rejectionReason: { type: String, trim: true },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    // Set on approval: the business that was created.
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant' },
    ipAddress: { type: String },
  },
  { timestamps: true }
);

registrationRequestSchema.index({ status: 1, createdAt: -1 });
registrationRequestSchema.index({ mobileNumber: 1, status: 1 });

export type RegistrationRequestDocument = InferSchemaType<typeof registrationRequestSchema> & {
  _id: Types.ObjectId;
};

export const RegistrationRequest = model('RegistrationRequest', registrationRequestSchema);
