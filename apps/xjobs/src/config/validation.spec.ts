import {
  getApifyToken,
  getAppConfig,
  getBasicAuthConfig,
  getStorageConfig,
  validateEnvironment,
  validateWorkerProcessEnvironment,
} from './index';

const minimal = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  SUPABASE_URL: 'http://localhost:8000',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  BASIC_AUTH_USERNAME: 'admin',
  BASIC_AUTH_PASSWORD: 'correct horse battery',
};

function storageConfigFor(raw: Record<string, unknown>) {
  const env = validateEnvironment(raw) as Record<string, unknown>;
  return getStorageConfig({ get: (key: string) => env[key] } as never);
}

describe('storage configuration', () => {
  it('reads the Supabase URL, key and default resumes bucket', () => {
    expect(storageConfigFor(minimal)).toEqual({
      supabaseUrl: 'http://localhost:8000',
      serviceRoleKey: 'service-key',
      resumesBucket: 'resumes',
    });
  });

  it("falls back to the Supabase stack's own variables", () => {
    expect(
      storageConfigFor({
        DATABASE_URL: minimal.DATABASE_URL,
        SUPABASE_PUBLIC_URL: 'http://localhost:8000',
        SERVICE_ROLE_KEY: 'legacy-key',
        BASIC_AUTH_USERNAME: minimal.BASIC_AUTH_USERNAME,
        BASIC_AUTH_PASSWORD: minimal.BASIC_AUTH_PASSWORD,
      }),
    ).toMatchObject({
      supabaseUrl: 'http://localhost:8000',
      serviceRoleKey: 'legacy-key',
    });
  });

  it('keeps an explicit bucket name', () => {
    expect(
      storageConfigFor({ ...minimal, STORAGE_RESUMES_BUCKET: 'cv' }),
    ).toMatchObject({ resumesBucket: 'cv' });
  });

  it('fails without any Supabase URL or key', () => {
    expect(() =>
      validateEnvironment({
        DATABASE_URL: minimal.DATABASE_URL,
        BASIC_AUTH_USERNAME: minimal.BASIC_AUTH_USERNAME,
        BASIC_AUTH_PASSWORD: minimal.BASIC_AUTH_PASSWORD,
      }),
    ).toThrow(/SUPABASE_URL[\s\S]*SUPABASE_SERVICE_ROLE_KEY/);
  });
});

describe('basic auth configuration', () => {
  it('reads the username and password', () => {
    const env = validateEnvironment(minimal) as Record<string, unknown>;
    expect(
      getBasicAuthConfig({ get: (key: string) => env[key] } as never),
    ).toEqual({
      username: 'admin',
      password: 'correct horse battery',
    });
  });

  it('refuses to start without credentials', () => {
    const { BASIC_AUTH_USERNAME, BASIC_AUTH_PASSWORD, ...rest } = minimal;
    expect(() => validateEnvironment(rest)).toThrow(
      /BASIC_AUTH_USERNAME[\s\S]*BASIC_AUTH_PASSWORD/,
    );
    expect(BASIC_AUTH_USERNAME && BASIC_AUTH_PASSWORD).toBeTruthy();
  });

  it('refuses a password shorter than 12 characters', () => {
    expect(() =>
      validateEnvironment({ ...minimal, BASIC_AUTH_PASSWORD: 'short' }),
    ).toThrow(/BASIC_AUTH_PASSWORD/);
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
      PROCESSOR_DECISION_MODEL: 'typesafe/jev-1.14',
      PROCESSOR_EXTRACTION_MODEL: 'deepseek/deepseek-v4.1-flash-1017',
      PROCESSOR_CONCURRENCY: 4,
      PROCESSOR_MAX_ATTEMPTS: 3,
      PROCESSOR_CLAIM_TIMEOUT_MS: 900_000,
      PROCESSOR_DAILY_BUDGET_USD: 20,
      PROCESSOR_MAX_REGENERATIONS: 2,
      PROCESSOR_GENERATION_TRIES: 3,
    });
  });

  it('allows zero regenerations but needs at least one generation try', () => {
    const processor = {
      ...worker,
      WORKER_ROLE: 'processor',
      OPENROUTER_API_KEY: 'or-key',
    };
    expect(
      validateWorkerProcessEnvironment({
        ...processor,
        PROCESSOR_MAX_REGENERATIONS: '0',
        PROCESSOR_GENERATION_TRIES: '1',
      }),
    ).toMatchObject({
      PROCESSOR_MAX_REGENERATIONS: 0,
      PROCESSOR_GENERATION_TRIES: 1,
    });
    expect(() =>
      validateWorkerProcessEnvironment({
        ...processor,
        PROCESSOR_MAX_REGENERATIONS: '-1',
      }),
    ).toThrow(/PROCESSOR_MAX_REGENERATIONS/);
    expect(() =>
      validateWorkerProcessEnvironment({
        ...processor,
        PROCESSOR_GENERATION_TRIES: '0',
      }),
    ).toThrow(/PROCESSOR_GENERATION_TRIES/);
  });
});
