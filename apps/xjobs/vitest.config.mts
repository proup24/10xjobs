import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { defineConfig, type Plugin } from 'vitest/config';

const WIRING_SPECS = 'src/**/*.wiring.spec.ts';

/**
 * Compiles the engine's own TypeScript with tsc instead of esbuild, so classes
 * carry `design:paramtypes` the way the webpack build does. Nest resolves
 * constructor injection from that metadata; esbuild never emits it.
 */
function decoratorMetadata(): Plugin {
  const srcDir = fileURLToPath(new URL('./src/', import.meta.url));
  return {
    name: 'xjobs-decorator-metadata',
    enforce: 'pre',
    transform(code, id) {
      if (!id.startsWith(srcDir) || !id.endsWith('.ts')) return null;
      const { outputText, sourceMapText } = ts.transpileModule(code, {
        fileName: id,
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2021,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          sourceMap: true,
        },
      });
      return {
        code: outputText,
        map: sourceMapText ? JSON.parse(sourceMapText) : null,
      };
    },
  };
}

const shared = {
  root: import.meta.dirname,
  resolve: {
    alias: { src: fileURLToPath(new URL('./src', import.meta.url)) },
    conditions: ['@xjobs/source'],
  },
  ssr: { resolve: { conditions: ['@xjobs/source'] } },
};

export default defineConfig(() => ({
  ...shared,
  cacheDir: '../../node_modules/.vite/apps/xjobs',
  test: {
    watch: false,
    passWithNoTests: true,
    reporters: ['default'],
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
    },
    projects: [
      {
        ...shared,
        test: {
          name: '@xjobs/xjobs',
          globals: true,
          environment: 'node',
          include: [
            '{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
          ],
          exclude: ['**/node_modules/**', WIRING_SPECS],
          // The PostgreSQL specs truncate one shared database, so they cannot overlap.
          fileParallelism: !process.env.PROCESSOR_TEST_DATABASE_URL,
        },
      },
      {
        // Builds the real Nest module graphs, which needs decorator metadata.
        ...shared,
        plugins: [decoratorMetadata()],
        test: {
          name: '@xjobs/xjobs-wiring',
          globals: true,
          environment: 'node',
          include: [WIRING_SPECS],
          // Dummy values: preview mode connects to nothing, but the modules
          // validate the environment when they are imported.
          env: {
            XJOBS_SKIP_ENV_FILES: '1',
            NODE_ENV: 'development',
            DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:1/none',
            REDIS_URL: 'redis://127.0.0.1:1',
            REDIS_CACHE_URL: 'redis://127.0.0.1:1',
            SUPABASE_URL: 'http://127.0.0.1:1',
            SUPABASE_SERVICE_ROLE_KEY: 'dummy',
            ENGINE_API_KEY: 'dummy-engine-key-000000000000000000',
            // Includes the operator modules in the API graph.
            XJOBS_OPERATOR_ENDPOINTS: '1',
          },
          // Importing the whole engine through tsc takes a while on a cold cache.
          testTimeout: 120_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
}));
