import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from 'src/config';
import { ApifyActorProvider } from './apify.provider';

const configWith = (token?: string) =>
  ({
    get: (key: string) => (key === 'APIFY_TOKEN' ? token : undefined),
  }) as unknown as ConfigService<EnvironmentVariables, true>;

describe('ApifyActorProvider', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends the token from the config service', async () => {
    const fetch = vi.fn(async () => Response.json([{ id: 1 }]));
    vi.stubGlobal('fetch', fetch);
    const items = await new ApifyActorProvider(configWith('secret')).run(
      'apify/google-search-scraper',
      { queries: 'q' },
      0.5,
    );
    expect(items).toEqual([{ id: 1 }]);
    const [url] = fetch.mock.calls[0] as unknown as [string];
    expect(url).toContain('/acts/apify~google-search-scraper/');
    expect(url).toContain('token=secret');
  });

  it('refuses to call Apify without a configured token', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(
      new ApifyActorProvider(configWith()).run('a/b', {}, 1),
    ).rejects.toThrow('APIFY_TOKEN is required for job collection');
    expect(fetch).not.toHaveBeenCalled();
  });
});
