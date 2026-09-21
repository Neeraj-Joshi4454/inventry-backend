/**
 * Application error hierarchy. Every thrown error that should produce a
 * clean, predictable HTTP response extends ApiError — the error middleware
 * (middleware/error.middleware.ts) knows how to render these; anything else
 * is treated as an unexpected 500 and its details are never sent to the client.
 */
export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly errors: unknown[];

  constructor(statusCode: number, message: string, errors: unknown[] = []) {
    super(message);
    this.statusCode = statusCode;
    this.errors = errors;
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class BadRequestError extends ApiError {
  constructor(message = 'Bad request', errors: unknown[] = []) {
    super(400, message, errors);
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message = 'Unauthorized') {
    super(401, message);
  }
}

export class ForbiddenError extends ApiError {
  constructor(message = 'Forbidden') {
    super(403, message);
  }
}

export class NotFoundError extends ApiError {
  constructor(message = 'Not found') {
    super(404, message);
  }
}

export class ConflictError extends ApiError {
  constructor(message: string, errors: unknown[] = []) {
    super(409, message, errors);
  }
}

// Thrown by inventory.service.ts when an atomic stock decrement fails its
// currentStock >= quantity guard (see docs/DATABASE_ARCHITECTURE.md §15).
// A ConflictError so clients can distinguish "lost the race / stock ran
// out" from a generic bad request.
export class InsufficientStockError extends ConflictError {
  constructor(productId: string, requested: number, available?: number) {
    super(
      `Insufficient stock for product ${productId}: requested ${requested}${
        available !== undefined ? `, available ${available}` : ''
      }`,
      [{ productId, requested, available }]
    );
  }
}
