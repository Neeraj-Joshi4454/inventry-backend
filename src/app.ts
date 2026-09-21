import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { corsOrigins } from './config/env';
import { logger } from './config/logger';
import { globalRateLimiter } from './middleware/rateLimiter.middleware';
import { sanitizeBody } from './middleware/sanitize.middleware';
import { errorHandler } from './middleware/error.middleware';
import { notFoundHandler } from './middleware/notFound.middleware';
import apiRoutes from './routes';

export function createApp() {
  const app = express();

  // Security headers first.
  app.use(helmet());

  // CORS is for browser clients only (the Next.js admin). Flutter is not a
  // browser and is unaffected. "*" is never used — an explicit allowlist
  // from CORS_ORIGIN, enforced empty-and-fail in production (see config/env.ts).
  app.use(
    cors({
      origin: corsOrigins.length > 0 ? corsOrigins : false,
      credentials: true,
    })
  );

  // Body parsers with explicit size limits — an unauthenticated client
  // should never be able to force the process to buffer an unbounded payload.
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  app.use(sanitizeBody);

  // Structured request logging (pino). Never logs Authorization headers,
  // cookies, or request/response bodies by default.
  app.use(
    pinoHttp({
      logger,
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    })
  );

  app.use(globalRateLimiter);

  // All application routes are versioned under /api/v1.
  app.use('/api/v1', apiRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
