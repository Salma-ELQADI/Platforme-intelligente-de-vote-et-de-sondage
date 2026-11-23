import rateLimit from 'express-rate-limit';
import { env } from '../config/env';

const handler = (message: string) => ({
  standardHeaders: 'draft-8' as const,
  legacyHeaders: false,
  // Rate limiting is disabled in automated tests (they fire many requests quickly).
  skip: () => env.isTest,
  message: { success: false, error: { code: 'RATE_LIMITED', message } },
});

/** Global safety net for the whole API. */
export const apiLimiter = rateLimit({ windowMs: 60_000, limit: 300, ...handler('Trop de requêtes, réessayez plus tard') });

/** Brute-force protection on login/register. */
export const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  ...handler('Trop de tentatives, réessayez dans quelques minutes'),
});

/** AI calls cost money: limit them per IP. */
export const aiLimiter = rateLimit({ windowMs: 60_000, limit: 10, ...handler('Trop de générations IA, patientez une minute') });
