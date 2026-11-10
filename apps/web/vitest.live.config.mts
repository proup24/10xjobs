import { defineConfig } from 'vitest/config';
import { join } from 'node:path';

// Live tests talk to a running engine and the local Supabase stack. They are
// excluded from `vitest.config.mts`; run them with `nx run web:test-live`.
export default defineConfig({
  root: import.meta.dirname,
  resolve: {
    alias: { '@': join(import.meta.dirname, './src') },
  },
  test: {
    name: 'web-live',
    watch: false,
    globals: true,
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ['src/**/*.live.spec.ts'],
    reporters: ['default'],
  },
});
