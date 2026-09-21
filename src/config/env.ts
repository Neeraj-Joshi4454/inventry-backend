import 'dotenv/config';
import { z } from 'zod';

// Fails fast with a clear error if a required variable is missing/invalid —
// the app must never start with an incomplete/insecure configuration.
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 chars'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 chars'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),
  // Comma-separated list of allowed origins, e.g.
  // "http://localhost:3000,http://localhost:8081". Never "*" in production
  // for an authenticated API — see config validation below.
  CORS_ORIGIN: z.string().default(''),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

export const corsOrigins = env.CORS_ORIGIN.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

if (env.NODE_ENV === 'production' && corsOrigins.length === 0) {
  console.error('CORS_ORIGIN must be set to an explicit allowlist in production.');
  process.exit(1);
}
