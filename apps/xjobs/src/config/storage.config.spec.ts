import { ConfigService } from '@nestjs/config';
import { getStorageConfig } from './index';

const configOf = (values: Record<string, string>) =>
  new ConfigService(values) as never;

describe('getStorageConfig', () => {
  // ConfigService reads process.env first, and Nx loads the local .env into
  // the test process, so clear the real values the specs stand in for.
  beforeEach(() => {
    for (const key of [
      'SUPABASE_URL',
      'SUPABASE_PUBLIC_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
      'SERVICE_ROLE_KEY',
    ])
      vi.stubEnv(key, undefined);
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ['http://127.0.0.1:54321', 'http://127.0.0.1:54321'],
    ['http://127.0.0.1:54321/', 'http://127.0.0.1:54321'],
    ['https://x.supabase.co///', 'https://x.supabase.co'],
  ])('normalises SUPABASE_URL %s', (input, expected) => {
    expect(
      getStorageConfig(
        configOf({ SUPABASE_URL: input, SUPABASE_SERVICE_ROLE_KEY: 'k' }),
      ).supabaseUrl,
    ).toBe(expected);
  });

  it('normalises the fallback SUPABASE_PUBLIC_URL too', () => {
    expect(
      getStorageConfig(
        configOf({
          SUPABASE_PUBLIC_URL: 'http://kong:8000/',
          SERVICE_ROLE_KEY: 'k',
        }),
      ).supabaseUrl,
    ).toBe('http://kong:8000');
  });
});
