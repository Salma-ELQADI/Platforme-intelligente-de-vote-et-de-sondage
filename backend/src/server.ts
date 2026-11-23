import http from 'node:http';
import { createApp } from './app';
import { env } from './config/env';
import { logger } from './config/logger';
import { pool } from './db/pool';
import { startPollCloser } from './jobs/pollCloser';
import { initSocket } from './socket';

async function main() {
  // Fail fast if PostgreSQL is unreachable.
  await pool.query('SELECT 1');

  const app = createApp();
  const httpServer = http.createServer(app); // Express and Socket.IO share the same port
  const io = initSocket(httpServer);
  const stopPollCloser = startPollCloser();

  httpServer.listen(env.PORT, () => {
    logger.info(`VoteLive API listening on http://localhost:${env.PORT} (docs: /api/docs)`);
    if (!env.OPENROUTER_API_KEY) logger.warn('OPENROUTER_API_KEY is empty: AI generation is disabled');
  });

  // Graceful shutdown: stop accepting work, then close resources.
  const shutdown = async (signal: string) => {
    logger.info(`${signal} received, shutting down`);
    stopPollCloser();
    io.close();
    httpServer.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});
