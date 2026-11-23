import pino from 'pino';
import { env } from './env';

/**
 * Structured JSON logger. In development the output is prettified;
 * in tests it is silenced unless LOG_LEVEL is explicitly set.
 */
export const logger = pino({
  level: env.isTest && !process.env.LOG_LEVEL ? 'silent' : env.LOG_LEVEL,
  // Never log credentials, even by accident.
  redact: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.password_hash'],
  transport:
    env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
      : undefined,
});
