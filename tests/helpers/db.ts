import mongoose from 'mongoose';
import { env } from '../../src/config/env';

/**
 * Shared DB lifecycle for integration test files. Call connectTestDb() in
 * beforeAll, clearTestDb() in beforeEach/afterEach, and disconnectTestDb()
 * in afterAll. Requires a local replica-set MongoDB — see README "Run tests".
 */
export async function connectTestDb(): Promise<void> {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(env.MONGODB_URI);
  }
}

export async function clearTestDb(): Promise<void> {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((collection) => collection.deleteMany({})));
}

export async function disconnectTestDb(): Promise<void> {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}
