import { createApp } from './app';
import { connectDB, disconnectDB } from './config/database';
import { env } from './config/env';
import { logger } from './config/logger';

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main() {
  // The DB connection must be established before the HTTP server starts
  // accepting requests — connectDB() is awaited first, so no request can
  // reach a route handler while the connection is still pending.
  await connectDB();
  const app = createApp();

  const server = app.listen(env.PORT, () => {
    logger.info(`Server listening on port ${env.PORT} (${env.NODE_ENV})`);
  });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${signal} received, shutting down gracefully`);

    // 1. Stop accepting new connections; let in-flight requests finish.
    server.close(async (closeErr) => {
      if (closeErr) {
        logger.error({ err: closeErr }, 'Error while closing HTTP server');
      }
      try {
        // 2. Close the MongoDB connection cleanly.
        await disconnectDB();
        logger.info('Shutdown complete');
        process.exit(closeErr ? 1 : 0);
      } catch (dbErr) {
        logger.error({ err: dbErr }, 'Error while closing MongoDB connection');
        process.exit(1);
      }
    });

    // Safety net: if something (a stuck connection, a hung request) blocks
    // graceful close, force-exit rather than hang forever in an orchestrator's
    // shutdown window.
    setTimeout(() => {
      logger.error('Graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error({ err }, 'Failed to start server');
  process.exit(1);
});
