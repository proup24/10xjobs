import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@xjobs/db-tests',
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
