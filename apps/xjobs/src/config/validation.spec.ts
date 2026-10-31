import {
  getApifyToken,
  getAppConfig,
  getBasicAuthConfig,
  getStorageConfig,
  validateEnvironment,
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
