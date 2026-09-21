import { Schema, model, type InferSchemaType, type Types } from 'mongoose';

const notificationSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, immutable: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User' }, // omitted => tenant-wide notification
    type: {
      type: String,
      enum: ['LOW_STOCK', 'OUT_OF_STOCK', 'ACCOUNT_STATUS', 'SYSTEM'],
      required: true,
    },
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    isRead: { type: Boolean, default: false },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

notificationSchema.index({ tenantId: 1, userId: 1, isRead: 1, createdAt: -1 });

export type NotificationDocument = InferSchemaType<typeof notificationSchema> & {
  _id: Types.ObjectId;
};

export const Notification = model('Notification', notificationSchema);
