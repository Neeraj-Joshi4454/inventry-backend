import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendPaginated, sendSuccess } from '../../utils/apiResponse';
import { getPaginationParams } from '../../utils/pagination';
import * as userService from './user.service';
import type {
  CreateUserInput,
  ListUsersQuery,
  ResetPasswordInput,
  UpdateUserInput,
  UpdateUserStatusInput,
} from './user.validators';
import type { ActorContext } from './user.service';

function actorFrom(req: Request): ActorContext {
  return {
    actorId: req.user!.userId,
    actorRole: req.user!.role,
    ipAddress: req.ip,
  };
}

export const createUserHandler = asyncHandler(async (req: Request, res: Response) => {
  const user = await userService.createUser(req.body as CreateUserInput, actorFrom(req));
  sendSuccess(res, 201, 'User created successfully', user);
});

export const listUsersHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as ListUsersQuery;
  const pagination = getPaginationParams(query);
  const { users, meta } = await userService.listUsers(query, pagination);
  sendPaginated(res, 200, 'Users fetched successfully', users, meta);
});

export const getUserHandler = asyncHandler(async (req: Request, res: Response) => {
  const user = await userService.getUserById(req.params.id as string);
  sendSuccess(res, 200, 'User fetched successfully', user);
});

export const updateUserHandler = asyncHandler(async (req: Request, res: Response) => {
  const user = await userService.updateUser(
    req.params.id as string,
    req.body as UpdateUserInput,
    actorFrom(req)
  );
  sendSuccess(res, 200, 'User updated successfully', user);
});

export const updateUserStatusHandler = asyncHandler(async (req: Request, res: Response) => {
  const { status } = req.body as UpdateUserStatusInput;
  const user = await userService.updateUserStatus(req.params.id as string, status, actorFrom(req));
  sendSuccess(res, 200, 'User status updated successfully', user);
});

export const resetUserPasswordHandler = asyncHandler(async (req: Request, res: Response) => {
  const { newPassword } = req.body as ResetPasswordInput;
  await userService.resetUserPassword(req.params.id as string, newPassword, actorFrom(req));
  sendSuccess(res, 200, 'Password reset successfully');
});
