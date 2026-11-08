import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendSuccess } from '../../utils/apiResponse';
import {
  getBranding,
  getBrandingImage,
  removeBankDetails,
  removeBrandingImage,
  saveBankDetails,
  saveBrandingImage,
} from './branding.service';
import type { BankDetailsInput, BrandingImageKind } from './branding.validators';

const actorOf = (req: Request) => ({
  tenantId: req.user!.tenantId!,
  userId: req.user!.userId,
  userRole: req.user!.role,
  ipAddress: req.ip,
});

export const getBrandingHandler = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, 'Branding fetched successfully', await getBranding(req.user!.tenantId!));
});

// Raw image bytes, not the JSON envelope — the app saves the body as a file.
export const getBrandingImageHandler = asyncHandler(async (req: Request, res: Response) => {
  const image = await getBrandingImage(req.user!.tenantId!, req.params.kind as BrandingImageKind);
  res
    .status(200)
    .set('Content-Type', image.contentType)
    .set('Last-Modified', image.updatedAt.toUTCString())
    .set('Cache-Control', 'private, no-cache')
    .send(image.data);
});

export const saveBrandingImageHandler = asyncHandler(async (req: Request, res: Response) => {
  const image = await saveBrandingImage(
    actorOf(req),
    req.params.kind as BrandingImageKind,
    req.get('Content-Type'),
    req.body
  );
  sendSuccess(res, 200, 'Image saved successfully', image);
});

export const removeBrandingImageHandler = asyncHandler(async (req: Request, res: Response) => {
  await removeBrandingImage(actorOf(req), req.params.kind as BrandingImageKind);
  sendSuccess(res, 200, 'Image removed successfully', null);
});

export const saveBankDetailsHandler = asyncHandler(async (req: Request, res: Response) => {
  const details = await saveBankDetails(actorOf(req), req.body as BankDetailsInput);
  sendSuccess(res, 200, 'Bank details saved successfully', details);
});

export const removeBankDetailsHandler = asyncHandler(async (req: Request, res: Response) => {
  await removeBankDetails(actorOf(req));
  sendSuccess(res, 200, 'Bank details removed successfully', null);
});
