import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 15_000,
    hookTimeout: 15_000,
    // DB-backed test files (auth/*, tenants/*, tenantIsolation) share one
    // physical test database and clear collections between tests — running
    // files in parallel would let them race on that shared state, so
    // suites run one file at a time. The DB-free tests (health, notFound,
    // validation, errorHandling) don't need this but are unaffected by it.
    fileParallelism: false,
  },
});
