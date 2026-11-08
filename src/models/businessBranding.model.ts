import { Schema, model, type InferSchemaType, type Types } from 'mongoose';

// Images are small (a UPI QR or a logo, resized on the phone before
// upload), so they live in MongoDB directly rather than in separate file
// storage. Kept out of the Tenant document so the frequently-read business
// settings never carry image bytes.
const brandingImageSchema = new Schema(
  {
    data: { type: Buffer, required: true },
    contentType: { type: String, required: true },
    updatedAt: { type: Date, required: true },
  },
  { _id: false }
);

const bankDetailsSchema = new Schema(
  {
    accountHolderName: { type: String, required: true, trim: true },
    bankName: { type: String, required: true, trim: true },
    accountNumber: { type: String, required: true, trim: true },
    ifsc: { type: String, required: true, trim: true, uppercase: true },
    branch: { type: String, trim: true },
    updatedAt: { type: Date, required: true },
  },
  { _id: false }
);

/**
 * One per business: the UPI QR and bank details customers pay into on New
 * Sale, and the logo printed on invoices. Stored on the server so every
 * phone signed in to the business sees them, and they survive reinstalling
 * the app or clearing its data.
 */
const businessBrandingSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      immutable: true,
      unique: true,
    },
    upiQr: { type: brandingImageSchema },
    businessLogo: { type: brandingImageSchema },
    bankDetails: { type: bankDetailsSchema },
  },
  { timestamps: true }
);

export type BusinessBrandingDocument = InferSchemaType<typeof businessBrandingSchema> & {
  _id: Types.ObjectId;
};

export const BusinessBranding = model('BusinessBranding', businessBrandingSchema);
