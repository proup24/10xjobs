import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config } from 'dotenv';

const ENV_FILES = ['.env.local', '.env'];
const WORKSPACE_MARKER = 'pnpm-workspace.yaml';

/**
 * @description Walks up from `start` to the workspace root and returns the
 * env files found on the way, nearest first. The app is started from the
 * workspace root by Nx, while the Prisma CLI and seeds run from `apps/xjobs`,
 * so both must resolve the same root `.env`.
 */
function findEnvFiles(start: string): string[] {
  const found: string[] = [];
  let dir = start;
  for (;;) {
    for (const file of ENV_FILES) {
      const path = join(dir, file);
      if (existsSync(path)) found.push(path);
    }
    const parent = dirname(dir);
    if (existsSync(join(dir, WORKSPACE_MARKER)) || parent === dir) return found;
    dir = parent;
  }
}

/**
 * @description Replaces `${NAME}` references with values from `env`, so
 * `DATABASE_URL` can be composed from the Supabase credentials in `.env`
 * instead of repeating the password. Unknown names expand to an empty string.
 */
function expandReferences(env: NodeJS.ProcessEnv, keys: string[]): void {
  for (const key of keys) {
    const value = env[key];
    if (!value?.includes('${')) continue;
    env[key] = value.replace(
      /\$\{([A-Z0-9_]+)\}/gi,
      (_, name) => env[name] ?? '',
    );
  }
}

let loaded = false;

/**
 * @description Loads the env files into `process.env` once. Variables already
 * set in the process (shell, Docker, CI secrets) always win over the files.
 */
export function loadEnvironmentFiles(start = process.cwd()): void {
  if (loaded) return;
  loaded = true;
  const keys = new Set<string>();
  for (const path of findEnvFiles(start)) {
    const { parsed } = config({ path, quiet: true });
    Object.keys(parsed ?? {}).forEach((key) => keys.add(key));
  }
  expandReferences(process.env, [...keys]);
}

/**
 * @description Entry-point loading for the API and worker. Containers and
 * integration runs set `XJOBS_SKIP_ENV_FILES=1` to use only explicitly supplied settings.
 */
export function loadApplicationEnvironment(): void {
  if (process.env.XJOBS_SKIP_ENV_FILES !== '1') loadEnvironmentFiles();
}
