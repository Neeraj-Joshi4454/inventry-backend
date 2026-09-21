import { z } from 'zod';
import type { PaginationMeta } from './apiResponse';

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export interface PaginationParams {
  page: number;
  limit: number;
  skip: number;
}

/**
 * Parses ?page & ?limit from an already-Zod-validated query object into
 * { page, limit, skip } for a Mongoose `.skip().limit()` query. Limit is
 * hard-capped at MAX_LIMIT regardless of what the client requests, so a
 * client can never force a full-collection scan via a huge `limit`.
 */
export function getPaginationParams(query: PaginationQuery): PaginationParams {
  const page = query.page;
  const limit = Math.min(query.limit, MAX_LIMIT);
  return { page, limit, skip: (page - 1) * limit };
}

export function buildPaginationMeta(total: number, page: number, limit: number): PaginationMeta {
  return { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}
