import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env';
import { logger } from './config/logger';
import { query } from './db/pool';
import { openApiDocument } from './docs/openapi';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { apiLimiter } from './middleware/rateLimit';
import { aiRouter } from './modules/ai/ai.routes';
import { authRouter } from './modules/auth/auth.routes';
import { notificationsRouter } from './modules/notifications/notifications.routes';
import { pollsRouter } from './modules/polls/polls.routes';
import { usersRouter } from './modules/users/users.routes';
import { votesRouter } from './modules/votes/votes.routes';

/** Builds the Express application (without listening), so tests can use it with supertest. */
export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1); // correct client IP for rate limiting behind one reverse proxy
  app.use(helmet()); // security headers (CSP, X-Content-Type-Options, ...)
  app.use(cors({ origin: env.clientOrigins, credentials: true })); // only the frontend may call the API with cookies
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  if (!env.isTest) {
    app.use(
      pinoHttp({
        logger,
        autoLogging: { ignore: (req) => req.url === '/api/health' },
        // One compact line per request: method, URL, status, duration.
        serializers: {
          req: (req) => ({ method: req.method, url: req.url }),
          res: (res) => ({ statusCode: res.statusCode }),
        },
        customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
      }),
    );
  }

  app.get('/api/health', async (_req, res) => {
    await query('SELECT 1');
    res.json({ success: true, data: { status: 'ok', database: 'up', time: new Date().toISOString() } });
  });

  // Swagger UI needs inline scripts, so Helmet's CSP is relaxed for this path only.
  app.use('/api/docs', helmet({ contentSecurityPolicy: false }), swaggerUi.serve, swaggerUi.setup(openApiDocument));

  app.use('/api', apiLimiter);
  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/polls', pollsRouter);
  app.use('/api/votes', votesRouter);
  app.use('/api/ai', aiRouter);
  app.use('/api/notifications', notificationsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
