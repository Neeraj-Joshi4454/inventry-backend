import { Schema, model, type InferSchemaType, type Types } from 'mongoose';

/**
 * A refresh session. The document's own _id is the "selector" half of the
 * client-facing refresh token (see utils/refreshTokenCrypto.ts); `tokenHash`
 * is an HMAC of the "validator" half — the raw secret is never stored.
 *
 * Rotation: on each successful /auth/refresh, this document is marked
 * revoked and a new session document is created, linked via
 * `replacedBySessionId` — that link is what lets reuse of an
 * already-rotated (revoked) token be detected as suspicious (see
 * refreshToken.service.ts).
 *
 * TTL index on `expiresAt` auto-deletes sessions past their lifetime —
 * revoked-but-not-yet-expired sessions are kept (not deleted immediately)
 * so reuse detection has something to compare against.
 */
const refreshTokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', default: null, immutable: true },
    tokenHash: { type: String, required: true },
    userAgent: { type: String },
    ipAddress: { type: String },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    replacedBySessionId: { type: Schema.Types.ObjectId, ref: 'RefreshToken', default: null },
    lastUsedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

refreshTokenSchema.index({ userId: 1, revokedAt: 1 });
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type RefreshTokenDocument = InferSchemaType<typeof refreshTokenSchema> & {
  _id: Types.ObjectId;
};

export const RefreshToken = model('RefreshToken', refreshTokenSchema);
