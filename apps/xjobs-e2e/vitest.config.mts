import { defaultClientConditions, defaultServerConditions } from 'vite';
import { defineConfig } from 'vitest/config';

// Vite ignores tsconfig `customConditions`, so without this the workspace libs
// (`@xjobs/engine-client`, `@xjobs/database/*`) resolve through `default` to a
// prebuilt `dist`. With it they resolve to their TS source, as tsc does. The
// node test environment resolves through `ssr`; both keep Vite's defaults.
const SOURCE = '@xjobs/source';

export default defineConfig({
  resolve: { conditions: [SOURCE, ...defaultClientConditions] },
  ssr: { resolve: { conditions: [SOURCE, ...defaultServerConditions] } },
  test: {
    name: '@xjobs/xjobs-e2e',
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    globalSetup: ['src/support/global-setup.ts'],
    setupFiles: ['src/support/test-setup.ts'],
  },
});
