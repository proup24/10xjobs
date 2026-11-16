import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Read the enums from source, so the tests need no build.
      '@xjobs/database/enums': join(
        import.meta.dirname,
        '../../libs/database/src/enums/index.ts',
      ),
    },
  },
  test: {
    name: '@xjobs/db-tests',
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
