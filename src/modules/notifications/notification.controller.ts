import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendSuccess } from '../../utils/apiResponse';
import { getPaginationParams } from '../../utils/pagination';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from './notification.service';
import type { ListNotificationsQuery } from './notification.validators';

export const listNotificationsHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as ListNotificationsQuery;
  const pagination = getPaginationParams(query);
  const result = await listNotifications(req.user!.tenantId!, query, pagination);
  sendSuccess(res, 200, 'Notifications fetched successfully', result);
});

export const markNotificationReadHandler = asyncHandler(async (req: Request, res: Response) => {
  await markNotificationRead(req.user!.tenantId!, req.params.id as string);
  sendSuccess(res, 200, 'Notification marked as read', null);
});

export const markAllNotificationsReadHandler = asyncHandler(async (req: Request, res: Response) => {
  await markAllNotificationsRead(req.user!.tenantId!);
  sendSuccess(res, 200, 'All notifications marked as read', null);
});
