import express, { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/role.middleware';
import { requireTenantContext, stripClientTenantId } from '../../middleware/tenant.middleware';
import { validate } from '../../middleware/validation.middleware';
import { UserRole } from '../../types/enums';
import {
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  bankDetailsSchema,
  brandingImageParamSchema,
} from './branding.validators';
import {
  getBrandingHandler,
  getBrandingImageHandler,
  removeBankDetailsHandler,
  removeBrandingImageHandler,
  saveBankDetailsHandler,
  saveBrandingImageHandler,
} from './branding.controller';

const router = Router();

router.use(authenticate, requireTenantContext, stripClientTenantId);

// Everyone in the business reads these — the QR and bank details are shown
// while creating a sale, the logo on every invoice. Only the owner and
// managers can change them.
const READ_ROLES = [
  UserRole.OWNER,
  UserRole.MANAGER,
  UserRole.STORE_KEEPER,
  UserRole.SALES_PERSON,
  UserRole.ACCOUNTANT,
] as const;
const WRITE_ROLES = [UserRole.OWNER, UserRole.MANAGER] as const;

router.get('/', requireRole(...READ_ROLES), getBrandingHandler);

router.get(
  '/images/:kind',
  requireRole(...READ_ROLES),
  validate({ params: brandingImageParamSchema }),
  getBrandingImageHandler
);

// The image is the raw request body (Content-Type: image/*). The app-wide
// JSON parser (1 MB) only handles application/json, so this route's own
// raw parser with a larger limit is what reads it.
router.put(
  '/images/:kind',
  requireRole(...WRITE_ROLES),
  validate({ params: brandingImageParamSchema }),
  express.raw({ type: ALLOWED_IMAGE_TYPES, limit: MAX_IMAGE_BYTES }),
  saveBrandingImageHandler
);

router.delete(
  '/images/:kind',
  requireRole(...WRITE_ROLES),
  validate({ params: brandingImageParamSchema }),
  removeBrandingImageHandler
);

router.put(
  '/bank-details',
  requireRole(...WRITE_ROLES),
  validate({ body: bankDetailsSchema }),
  saveBankDetailsHandler
);

router.delete('/bank-details', requireRole(...WRITE_ROLES), removeBankDetailsHandler);

export default router;
