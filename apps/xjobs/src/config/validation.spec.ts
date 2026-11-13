import {
  getApifyToken,
  getAppConfig,
  getEngineApiKey,
  getStorageConfig,
  validateEnvironment,
  validateWorkerProcessEnvironment,
} from './index';
import { workerProcessEnvironmentSchema } from './environment.validation';

const minimal = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  SUPABASE_URL: 'http://localhost:8000',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  ENGINE_API_KEY: 'k'.repeat(32),
};

function storageConfigFor(raw: Record<string, unknown>) {
  const env = validateEnvironment(raw) as Record<string, unknown>;
  return getStorageConfig({ get: (key: string) => env[key] } as never);
}

describe('storage configuration', () => {
  it('reads the Supabase URL, key and service-role key', () => {
    expect(storageConfigFor(minimal)).toEqual({
      supabaseUrl: 'http://localhost:8000',
      serviceRoleKey: 'service-key',
    });
  });

  it("falls back to the Supabase stack's own variables", () => {
    expect(
      storageConfigFor({
        DATABASE_URL: minimal.DATABASE_URL,
        SUPABASE_PUBLIC_URL: 'http://localhost:8000',
        SERVICE_ROLE_KEY: 'legacy-key',
        ENGINE_API_KEY: minimal.ENGINE_API_KEY,
      }),
    ).toMatchObject({
      supabaseUrl: 'http://localhost:8000',
      serviceRoleKey: 'legacy-key',
    });
  });

  it('fails without any Supabase URL or key', () => {
    expect(() =>
      validateEnvironment({
        DATABASE_URL: minimal.DATABASE_URL,
        ENGINE_API_KEY: minimal.ENGINE_API_KEY,
      }),
    ).toThrow(/SUPABASE_URL[\s\S]*SUPABASE_SERVICE_ROLE_KEY/);
  });
});

describe('engine API key configuration', () => {
  it('reads the key', () => {
    const env = validateEnvironment(minimal) as Record<string, unknown>;
    expect(getEngineApiKey({ get: (key: string) => env[key] } as never)).toBe(
      'k'.repeat(32),
    );
  });

  it('refuses to start without a key', () => {
    const { ENGINE_API_KEY: _key, ...rest } = minimal;
    expect(() => validateEnvironment(rest)).toThrow(/ENGINE_API_KEY/);
  });

  it('refuses a key of 31 characters', () => {
    expect(() =>
      validateEnvironment({ ...minimal, ENGINE_API_KEY: 'k'.repeat(31) }),
    ).toThrow(/ENGINE_API_KEY must be at least 32 characters/);
  });
});

describe('operator endpoints flag', () => {
  it('is off by default', () => {
    expect(validateEnvironment(minimal)).toMatchObject({
      XJOBS_OPERATOR_ENDPOINTS: false,
    });
  });

  it('refuses XJOBS_OPERATOR_ENDPOINTS=1 with NODE_ENV=production', () => {
    expect(() =>
      validateEnvironment({
        ...minimal,
        NODE_ENV: 'production',
        XJOBS_OPERATOR_ENDPOINTS: '1',
      }),
    ).toThrow(/XJOBS_OPERATOR_ENDPOINTS is local only/);
  });

  it('accepts it in development', () => {
    expect(
      validateEnvironment({
        ...minimal,
        NODE_ENV: 'development',
        XJOBS_OPERATOR_ENDPOINTS: '1',
      }),
    ).toMatchObject({ XJOBS_OPERATOR_ENDPOINTS: true });
  });
});

describe('collector and tooling configuration', () => {
  const configFor = (raw: Record<string, unknown>) => {
    const env = validateEnvironment({ ...minimal, ...raw }) as Record<
      string,
      unknown
    >;
    return { get: (key: string) => env[key] } as never;
  };

  it('serves the Apify token through the config service', () => {
    expect(getApifyToken(configFor({ APIFY_TOKEN: 'apify-token' }))).toBe(
      'apify-token',
    );
  });

  it('boots without an Apify token and fails only when collection asks for it', () => {
    const config = configFor({});
    expect(() => getApifyToken(config)).toThrow(
      'APIFY_TOKEN is required for job collection',
    );
  });

  it("exposes Nx's ready-signal socket through the app config", () => {
    expect(
      getAppConfig(configFor({ NX_READY_SIGNAL_SOCKET: '/tmp/nx.sock' }))
        .readySignalSocket,
    ).toBe('/tmp/nx.sock');
  });
});

describe('worker process configuration', () => {
  const worker = {
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    SUPABASE_URL: 'http://localhost:8000',
    SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  };

  it('refuses any worker without Supabase storage, which batches are written to', () => {
    const { SUPABASE_URL: _url, ...noUrl } = worker;
    expect(() => validateWorkerProcessEnvironment(noUrl)).toThrow(
      'Set SUPABASE_URL (or SUPABASE_PUBLIC_URL)',
    );
    const { SUPABASE_SERVICE_ROLE_KEY: _key, ...noKey } = worker;
    expect(() =>
      validateWorkerProcessEnvironment({
        ...noKey,
        WORKER_CHANNEL: 'ASHBY',
        APIFY_TOKEN: 'apify-token',
      }),
    ).toThrow('Set SUPABASE_SERVICE_ROLE_KEY (or SERVICE_ROLE_KEY)');
  });

  it("accepts the Supabase stack's own storage variables", () => {
    expect(() =>
      validateWorkerProcessEnvironment({
        DATABASE_URL: worker.DATABASE_URL,
        SUPABASE_PUBLIC_URL: 'http://localhost:8000',
        SERVICE_ROLE_KEY: 'service-key',
      }),
    ).not.toThrow();
  });

  it('runs the infrastructure worker without a channel or Apify token', () => {
    expect(validateWorkerProcessEnvironment(worker)).toMatchObject({
      REDIS_PREFIX: 'xjobs',
    });
    expect(
      validateWorkerProcessEnvironment(worker).WORKER_CHANNEL,
    ).toBeUndefined();
  });

  it('registers schedules only when XJOBS_RUN_SCHEDULES is truthy; unset is off', () => {
    const run = (v?: string) =>
      validateWorkerProcessEnvironment({
        ...worker,
        ...(v === undefined ? {} : { XJOBS_RUN_SCHEDULES: v }),
      }).XJOBS_RUN_SCHEDULES;
    expect(run()).toBe(false);
    expect(run('1')).toBe(true);
    expect(run('true')).toBe(true);
    expect(run('0')).toBe(false);
    // booleanFlag rejects the empty string: leave the variable unset to turn it off.
    expect(() => run('')).toThrow('XJOBS_RUN_SCHEDULES');
  });

  it('rejects an unrecognised XJOBS_RUN_SCHEDULES value', () => {
    const result = workerProcessEnvironmentSchema.safeParse({
      ...worker,
      XJOBS_RUN_SCHEDULES: 'maybe',
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path)).toContainEqual([
      'XJOBS_RUN_SCHEDULES',
    ]);
  });

  it('accepts a channel with an Apify token', () => {
    expect(
      validateWorkerProcessEnvironment({
        ...worker,
        WORKER_CHANNEL: 'ASHBY',
        APIFY_TOKEN: 'apify-token',
      }),
    ).toMatchObject({ WORKER_CHANNEL: 'ASHBY' });
  });

  it('refuses an unknown channel', () => {
    expect(() =>
      validateWorkerProcessEnvironment({
        ...worker,
        WORKER_CHANNEL: 'ASHBYY',
        APIFY_TOKEN: 'apify-token',
      }),
    ).toThrow(/WORKER_CHANNEL/);
  });

  it('runs the ingest worker without an Apify token', () => {
    expect(
      validateWorkerProcessEnvironment({ ...worker, WORKER_ROLE: 'ingest' }),
    ).toMatchObject({ WORKER_ROLE: 'ingest' });
  });

  it('runs the match worker without keys', () => {
    expect(
      validateWorkerProcessEnvironment({ ...worker, WORKER_ROLE: 'match' }),
    ).toMatchObject({ WORKER_ROLE: 'match' });
  });

  it('refuses an unknown worker role', () => {
    expect(() =>
      validateWorkerProcessEnvironment({ ...worker, WORKER_ROLE: 'other' }),
    ).toThrow(/WORKER_ROLE/);
  });

  it('refuses a worker role together with a channel', () => {
    expect(() =>
      validateWorkerProcessEnvironment({
        ...worker,
        WORKER_ROLE: 'ingest',
        WORKER_CHANNEL: 'ASHBY',
        APIFY_TOKEN: 'apify-token',
      }),
    ).toThrow(/WORKER_ROLE/);
  });

  it('refuses the ingest worker without Supabase storage', () => {
    expect(() =>
      validateWorkerProcessEnvironment({
        DATABASE_URL: worker.DATABASE_URL,
        WORKER_ROLE: 'ingest',
      }),
    ).toThrow('Set SUPABASE_URL (or SUPABASE_PUBLIC_URL)');
  });

  it('refuses a channel without an Apify token', () => {
    expect(() =>
      validateWorkerProcessEnvironment({ ...worker, WORKER_CHANNEL: 'ASHBY' }),
    ).toThrow(/APIFY_TOKEN/);
  });

  it('refuses the processor role without an OpenRouter key', () => {
    expect(() =>
      validateWorkerProcessEnvironment({ ...worker, WORKER_ROLE: 'processor' }),
    ).toThrow(/OPENROUTER_API_KEY/);
  });

  it('does not require the OpenRouter key in the all role: the processor then stays off', () => {
    const all = { ...worker, WORKER_ROLE: 'all', APIFY_TOKEN: 'apify-token' };
    expect(validateWorkerProcessEnvironment(all).OPENROUTER_API_KEY).toBe(
      undefined,
    );
  });

  it('parses the processor defaults when the key is set', () => {
    expect(
      validateWorkerProcessEnvironment({
        ...worker,
        WORKER_ROLE: 'processor',
        OPENROUTER_API_KEY: 'or-key',
      }),
    ).toMatchObject({
      PROCESSOR_EXTRACTION_MODEL: 'deepseek/deepseek-v4.1-flash-1017',
      PROCESSOR_CONCURRENCY: 4,
      PROCESSOR_MAX_ATTEMPTS: 3,
      PROCESSOR_CLAIM_TIMEOUT_MS: 900_000,
      PROCESSOR_DAILY_BUDGET_USD: 20,
      PROCESSOR_GENERATION_TRIES: 3,
    });
  });

  it('needs at least one generation try and caps them at 5', () => {
    const processor = {
      ...worker,
      WORKER_ROLE: 'processor',
      OPENROUTER_API_KEY: 'or-key',
    };
    expect(
      validateWorkerProcessEnvironment({
        ...processor,
        PROCESSOR_GENERATION_TRIES: '1',
      }),
    ).toMatchObject({ PROCESSOR_GENERATION_TRIES: 1 });
    expect(
      validateWorkerProcessEnvironment({
        ...processor,
        PROCESSOR_GENERATION_TRIES: '5',
      }),
    ).toMatchObject({ PROCESSOR_GENERATION_TRIES: 5 });
    for (const tries of ['0', '6'])
      expect(() =>
        validateWorkerProcessEnvironment({
          ...processor,
          PROCESSOR_GENERATION_TRIES: tries,
        }),
      ).toThrow(/PROCESSOR_GENERATION_TRIES/);
  });
});
