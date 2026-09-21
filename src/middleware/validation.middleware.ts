import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodType } from 'zod';
import { BadRequestError } from '../utils/errors';

export interface ValidationSchemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

/**
 * Reusable request-validation middleware. Parses whichever of body/query/
 * params a route declares, replaces req.<part> with the parsed (and
 * type-coerced/defaulted) value, and turns a ZodError into a single
 * consistent 400 response — so no controller ever hand-rolls validation
 * error formatting.
 *
 * Usage:
 *   router.post('/', validate({ body: createProductSchema }), controller)
 */
export function validate(schemas: ValidationSchemas) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }
      if (schemas.query) {
        const parsedQuery = schemas.query.parse(req.query);
        // Express 5's req.query is a getter that RE-PARSES req.url from
        // scratch on every access (see express/lib/request.js) — it does
        // not cache. Mutating the object a read of req.query returns (via
        // Object.assign/delete) mutates a throwaway value that the next
        // read of req.query discards, silently undoing every default,
        // coercion, and transform Zod just applied. The getter is defined
        // with `configurable: true` specifically so it can be replaced;
        // redefining the property (instead of mutating through it) is the
        // fix — every later read of req.query in this request now returns
        // the validated/coerced/defaulted value directly.
        Object.defineProperty(req, 'query', {
          value: parsedQuery,
          writable: true,
          enumerable: true,
          configurable: true,
        });
      }
      if (schemas.params) {
        const parsedParams = schemas.params.parse(req.params) as Record<string, unknown>;
        Object.assign(req.params, parsedParams);
      }
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const errors = err.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        }));
        next(new BadRequestError('Validation failed', errors));
        return;
      }
      next(err);
    }
  };
}
