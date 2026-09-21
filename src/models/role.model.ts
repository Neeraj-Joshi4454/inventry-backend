import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { UserRole } from '../types/enums';

/**
 * Reference/lookup collection for roles — NOT the authorization source of
 * truth. Authorization decisions are made against the fixed `UserRole` enum
 * on User.role (checked in middleware/role.middleware.ts), which is
 * fast (no lookup/join) and trivially auditable.
 *
 * This collection exists so the Next.js admin (and, later, a tenant-facing
 * "invite user" screen) has a queryable source for role labels/descriptions
 * instead of hardcoding them in every frontend. It is system-wide (no
 * tenantId) — roles are a fixed part of the product, not something a tenant
 * customizes. If custom per-tenant roles are ever needed, that's a
 * deliberate phase-2 redesign (roles gain a tenantId and a permissions
 * array, and authorize() starts consulting this collection) — not something
 * to grow into accidentally.
 */
const roleSchema = new Schema(
  {
    key: { type: String, enum: Object.values(UserRole), required: true, unique: true },
    label: { type: String, required: true },
    description: { type: String, required: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export type RoleDocument = InferSchemaType<typeof roleSchema> & { _id: Types.ObjectId };

export const Role = model('Role', roleSchema);
