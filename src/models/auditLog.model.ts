import { Schema, model, type InferSchemaType, type Types } from 'mongoose';

const auditLogSchema = new Schema(
  {
    // null for platform-level actions performed by SUPER_ADMIN (e.g. creating a tenant).
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', default: null, immutable: true },
    actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    actorRole: { type: String, required: true },
    action: { type: String, required: true }, // e.g. "SALE_CREATED", "USER_SUSPENDED"
    entityType: { type: String, required: true },
    entityId: { type: Schema.Types.ObjectId, required: true },
    changes: {
      before: { type: Schema.Types.Mixed },
      after: { type: Schema.Types.Mixed },
    },
    ipAddress: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditLogSchema.index({ tenantId: 1, createdAt: -1 });
auditLogSchema.index({ entityType: 1, entityId: 1 });

export type AuditLogDocument = InferSchemaType<typeof auditLogSchema> & { _id: Types.ObjectId };

export const AuditLog = model('AuditLog', auditLogSchema);
