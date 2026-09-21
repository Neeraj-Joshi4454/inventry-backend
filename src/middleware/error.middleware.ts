import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import mongoose from 'mongoose';
import { ApiError } from '../utils/errors';
import { env } from '../config/env';
import { logger } from '../config/logger';

/**
 * Single place every error in the app funnels through. Response shape is
 * always { success: false, message, errors: [] } — no other error format
 * is used anywhere in the codebase. Never leaks a stack trace, raw
 * Mongoose/Mongo error text, or internal details in production.
 */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) {
    res.status(err.statusCode).json({ success: false, message: err.message, errors: err.errors });
    return;
  }

  if (err instanceof ZodError) {
    const errors = err.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));
    res.status(400).json({ success: false, message: 'Validation failed', errors });
    return;
  }

  if (err instanceof mongoose.Error.ValidationError) {
    const errors = Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }));
    res.status(400).json({ success: false, message: 'Validation failed', errors });
    return;
  }

  if (err instanceof mongoose.Error.CastError) {
    res.status(400).json({
      success: false,
      message: `Invalid value for field "${err.path}"`,
      errors: [{ field: err.path, message: `Expected a valid ${err.kind}` }],
    });
    return;
  }

  if (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 11000
  ) {
    const keyValue = (err as { keyValue?: Record<string, unknown> }).keyValue ?? {};
    res.status(409).json({
      success: false,
      message: 'A record with these details already exists',
      errors: Object.keys(keyValue).map((field) => ({ field, message: 'Must be unique' })),
    });
    return;
  }

  // Unexpected error: log full detail server-side, never leak it to the client.
  logger.error({ err }, 'Unhandled error');
  res.status(500).json({
    success: false,
    message:
      env.NODE_ENV === 'production'
        ? 'Something went wrong'
        : ((err as Error)?.message ?? 'Something went wrong'),
    errors: [],
  });
}
