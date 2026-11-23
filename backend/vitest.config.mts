import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['tests/globalSetup.ts'],
    // All test files share one PostgreSQL test database: run them one after another.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://votelive:votelive@localhost:5432/votelive_test',
      JWT_SECRET: 'test-secret-test-secret-test-secret-123456',
      BCRYPT_ROUNDS: '4', // fast hashing in tests only
      OPENROUTER_API_KEY: 'test-key',
      OPENROUTER_MODEL: 'test/model',
      OPENROUTER_TIMEOUT_MS: '300',
      CLIENT_URL: 'http://localhost:3000',
    },
  },
});
