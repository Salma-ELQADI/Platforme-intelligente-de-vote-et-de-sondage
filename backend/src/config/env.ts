import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

// Load backend/.env (no-op if the file does not exist). Tests get their
// configuration from vitest.config.mts only, never from the developer's .env.
if (process.env.NODE_ENV !== 'test') {
  dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
}

/**
 * All configuration is read from environment variables and validated once at
 * startup. A missing or malformed variable stops the process immediately
 * instead of failing later in the middle of a request.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  CLIENT_URL: z.string().default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must contain at least 32 characters'),
  JWT_EXPIRES_IN: z.string().regex(/^\d+\s*[smhd]?$/, 'JWT_EXPIRES_IN must look like 3600, 15m, 12h or 7d').default('1d'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),

  OPENROUTER_API_KEY: z.string().default(''),
  OPENROUTER_MODEL: z.string().default('openai/gpt-4o-mini'),
  OPENROUTER_BASE_URL: z.string().url().default('https://openrouter.ai/api/v1'),
  OPENROUTER_TIMEOUT_MS: z.coerce.number().int().positive().default(20000),

  POLL_CLOSER_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Do not print the values themselves: they may contain secrets.
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  console.error(`Invalid environment configuration:\n${issues}`);
  process.exit(1);
}

export const env = {
  ...parsed.data,
  isProduction: parsed.data.NODE_ENV === 'production',
  isTest: parsed.data.NODE_ENV === 'test',
  clientOrigins: parsed.data.CLIENT_URL.split(',').map((o) => o.trim()).filter(Boolean),
};
