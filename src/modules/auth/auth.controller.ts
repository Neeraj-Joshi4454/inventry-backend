import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendSuccess } from '../../utils/apiResponse';
import { UnauthorizedError } from '../../utils/errors';
import * as authService from './auth.service';
import type { ChangePasswordInput, LoginInput, LogoutInput, RefreshInput } from './auth.validators';
import type { SessionMeta } from './refreshToken.service';

function sessionMeta(req: Request): SessionMeta {
  const userAgentHeader = req.headers['user-agent'];
  return {
    userAgent: Array.isArray(userAgentHeader) ? userAgentHeader[0] : userAgentHeader,
    ipAddress: req.ip,
  };
}

export const loginHandler = asyncHandler(async (req: Request, res: Response) => {
  const { mobileNumber, password } = req.body as LoginInput;
  const result = await authService.login(mobileNumber, password, sessionMeta(req));
  sendSuccess(res, 200, 'Login successful', result);
});

export const refreshHandler = asyncHandler(async (req: Request, res: Response) => {
  const { refreshToken } = req.body as RefreshInput;
  const result = await authService.refresh(refreshToken, sessionMeta(req));
  sendSuccess(res, 200, 'Token refreshed successfully', result);
});

export const logoutHandler = asyncHandler(async (req: Request, res: Response) => {
  const { refreshToken } = req.body as LogoutInput;
  await authService.logout(refreshToken);
  sendSuccess(res, 200, 'Logged out successfully');
});

export const meHandler = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();
  const me = await authService.getMe(req.user.userId);
  sendSuccess(res, 200, 'Current user fetched successfully', me);
});

export const changePasswordHandler = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();
  const { currentPassword, newPassword } = req.body as ChangePasswordInput;
  await authService.changePassword(req.user.userId.toString(), currentPassword, newPassword);
  sendSuccess(res, 200, 'Password changed successfully');
});
