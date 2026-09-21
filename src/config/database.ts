import mongoose from 'mongoose';
import { env } from './env';
import { logger } from './logger';

mongoose.set('strictQuery', true);

const READY_STATE_LABELS: Record<number, string> = {
  0: 'DISCONNECTED',
  1: 'CONNECTED',
  2: 'CONNECTING',
  3: 'DISCONNECTING',
};

export async function connectDB(): Promise<void> {
  mongoose.connection.on('connected', () => logger.info('MongoDB connected'));
  mongoose.connection.on('error', (err) => logger.error({ err }, 'MongoDB connection error'));
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));

  await mongoose.connect(env.MONGODB_URI, {
    // Reasonable pool defaults for a single API instance. Tune upward if
    // profiling shows connection-pool exhaustion under real load.
    maxPoolSize: 20,
    minPoolSize: 2,
    serverSelectionTimeoutMS: 10_000,
    socketTimeoutMS: 45_000,
  });

  // Transactions require a replica set. Fail fast in a clear way instead of
  // discovering this only when the first sale/purchase transaction throws.
  const hello = await mongoose.connection.db?.admin().command({ hello: 1 });
  if (!hello?.setName) {
    logger.warn(
      'MongoDB is not running as a replica set. Multi-document transactions ' +
        '(sales, purchases, stock adjustments) will fail. See .env.example for local setup notes.'
    );
  }
}

export async function disconnectDB(): Promise<void> {
  await mongoose.disconnect();
}

/** Used by the /api/v1/health endpoint to report live DB connectivity. */
export function getDatabaseStatus(): { state: string; readyState: number } {
  const readyState = mongoose.connection.readyState;
  return { state: READY_STATE_LABELS[readyState] ?? 'UNKNOWN', readyState };
}
