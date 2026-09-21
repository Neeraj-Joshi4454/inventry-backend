import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendPaginated } from '../../utils/apiResponse';
import { getPaginationParams } from '../../utils/pagination';
import { UserRole } from '../../types/enums';
import { listAuditLogs } from './auditLog.service';
import type { ListAuditLogsQuery } from './auditLog.validators';

// SUPER_ADMIN sees the platform-wide log (optionally filtered to one
// tenant via ?tenantId=); every other role only ever sees their OWN
// tenant's log, forced from req.user.tenantId — a tenantId in the query
// string is never trusted for a non-SUPER_ADMIN caller, even if present.
export const listAuditLogsHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as ListAuditLogsQuery;
  const pagination = getPaginationParams(query);

  const filter =
    req.user!.role === UserRole.SUPER_ADMIN
      ? query.tenantId
        ? { tenantId: new Types.ObjectId(query.tenantId) }
        : {}
      : { tenantId: req.user!.tenantId! };

  const { logs, meta } = await listAuditLogs(filter, pagination);
  sendPaginated(res, 200, 'Audit logs fetched successfully', logs, meta);
});
