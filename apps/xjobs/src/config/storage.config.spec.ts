import { ConfigService } from '@nestjs/config';
import { getStorageConfig } from './index';

const configOf = (values: Record<string, string>) =>
  new ConfigService(values) as never;

describe('getStorageConfig', () => {
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
