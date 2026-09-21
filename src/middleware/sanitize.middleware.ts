import type { NextFunction, Request, Response } from 'express';

/**
 * Strips keys that look like Mongo operators ("$gt", "$where", ...) or
 * contain a "." (dot-path injection, e.g. "a.$set") from req.body,
 * recursively. This is defense-in-depth against NoSQL operator injection —
 * the primary defense is that no controller in this codebase ever passes
 * raw req.body/req.query straight into a Mongo filter; see utils/queryFilters.ts
 * for the allowlist-based approach used for read filters.
 *
 * Applied only to req.body: Express 5 makes req.query/req.params read-only
 * getters, and every query-string filter in this app already goes through
 * buildAllowedFilter()/validate() rather than being passed through raw, so
 * body is the only untrusted input that flows toward Mongo write paths.
 */
export function sanitizeBody(req: Request, _res: Response, next: NextFunction) {
  if (req.body && typeof req.body === 'object') {
    req.body = stripDangerousKeys(req.body);
  }
  next();
}

function stripDangerousKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripDangerousKeys);
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (key.startsWith('$') || key.includes('.')) continue;
      result[key] = stripDangerousKeys(val);
    }
    return result;
  }
  return value;
}
