import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: import.meta.dirname,
  resolve: {
    alias: { src: fileURLToPath(new URL('./src', import.meta.url)) },
    conditions: ['@xjobs/source'],
  },
  ssr: { resolve: { conditions: ['@xjobs/source'] } },
  cacheDir: '../../node_modules/.vite/apps/xjobs',
  test: {
    name: '@xjobs/xjobs',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    passWithNoTests: true,
    // The PostgreSQL specs truncate one shared database, so they cannot overlap.
    fileParallelism: !process.env.PROCESSOR_TEST_DATABASE_URL,
    reporters: ['default'],
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
    },
  },
}));
