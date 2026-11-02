import { execFileSync } from 'node:child_process';

export type StackEnv = { url: string; anonKey: string; serviceRoleKey: string };

const NOT_REACHABLE =
  'Supabase stack not reachable: run pnpm db:start (or set SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY)';

let lastCliError: unknown;

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

/** The engine reads the same variable names, so a shell may hold hosted credentials. */
function assertLocal(url: string): void {
  const host = new URL(url).hostname;
  if (LOCAL_HOSTS.has(host) || process.env.DB_TESTS_ALLOW_REMOTE === '1')
    return;
  throw new Error(
    `Refusing to run db-tests against non-local host ${host}: the tests create users. Set DB_TESTS_ALLOW_REMOTE=1 to allow it.`,
  );
}

function fromEnv(): StackEnv | undefined {
  const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } =
    process.env;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY)
    return undefined;
  return {
    url: SUPABASE_URL,
    anonKey: SUPABASE_ANON_KEY,
    serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
  };
}

function fromCli(): StackEnv | undefined {
  try {
    const out = execFileSync(
      'pnpm',
      ['--workspace-root', 'exec', 'supabase', 'status', '-o', 'json'],
      {
        timeout: 15_000,
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
      },
    );
    const status = JSON.parse(out) as Record<string, string | undefined>;
    const { API_URL, ANON_KEY, SERVICE_ROLE_KEY } = status;
    if (!API_URL || !ANON_KEY || !SERVICE_ROLE_KEY) return undefined;
    return {
      url: API_URL,
      anonKey: ANON_KEY,
      serviceRoleKey: SERVICE_ROLE_KEY,
    };
  } catch (cause) {
    lastCliError = cause;
    return undefined;
  }
}

export function loadStackEnv(): StackEnv {
  const env = fromEnv() ?? fromCli();
  if (!env) throw new Error(NOT_REACHABLE, { cause: lastCliError });
  assertLocal(env.url);
  return env;
}
