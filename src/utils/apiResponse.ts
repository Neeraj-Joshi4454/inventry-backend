import type { Response } from 'express';

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/** { success: true, message, data } */
export function sendSuccess(
  res: Response,
  statusCode: number,
  message: string,
  data: unknown = {}
) {
  return res.status(statusCode).json({ success: true, message, data });
}

/** { success: true, message, data: [...], meta: { page, limit, total, totalPages } } */
export function sendPaginated(
  res: Response,
  statusCode: number,
  message: string,
  data: unknown[],
  meta: PaginationMeta
) {
  return res.status(statusCode).json({ success: true, message, data, meta });
}
