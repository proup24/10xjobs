import { getStorageConfig, validateEnvironment } from './index';

const minimal = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  SUPABASE_URL: 'http://localhost:8000',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
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
      validateEnvironment({ DATABASE_URL: minimal.DATABASE_URL }),
    ).toThrow(/SUPABASE_URL[\s\S]*SUPABASE_SERVICE_ROLE_KEY/);
  });
});
