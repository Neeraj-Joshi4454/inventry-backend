import mongoose, { type ClientSession } from 'mongoose';
import { logger } from '../config/logger';

interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
}

/**
 * Runs `fn` inside a MongoDB multi-document transaction, retrying on
 * TransientTransactionError (a write-conflict signal Mongo can raise under
 * contention) with exponential backoff. ApiError-style business failures
 * (e.g. InsufficientStockError) are NOT retried — they propagate immediately
 * so the caller returns the correct 4xx to the client.
 */
export async function runInTransaction<T>(
  fn: (session: ClientSession) => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const { maxRetries = 3, baseDelayMs = 50 } = options;

  let attempt = 0;
  for (;;) {
    const session = await mongoose.startSession();
    try {
      let result!: T;
      await session.withTransaction(async () => {
        result = await fn(session);
      });
      return result;
    } catch (err) {
      const isTransient =
        err instanceof mongoose.mongo.MongoServerError &&
        err.hasErrorLabel?.('TransientTransactionError');

      if (isTransient && attempt < maxRetries) {
        attempt += 1;
        const delay = baseDelayMs * 2 ** (attempt - 1);
        logger.warn({ attempt, delay }, 'Transient transaction error, retrying');
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw err;
    } finally {
      await session.endSession();
    }
  }
}
