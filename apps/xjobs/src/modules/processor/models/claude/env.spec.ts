import { ProviderUnavailableError } from '../errors';
import { claudeEnv } from './env';

const HOME = '/tmp/empty-home';

describe('claudeEnv', () => {
  it('passes only PATH, HOME, the OAuth token and the autoupdater switch', () => {
    const env = claudeEnv(
      {
        PATH: '/usr/bin',
        CLAUDE_CODE_OAUTH_TOKEN: 'oauth',
        DATABASE_URL: 'postgres://secret',
        SUPABASE_SERVICE_ROLE_KEY: 'service',
        APIFY_TOKEN: 'apify',
        REDIS_URL: 'redis://secret',
      },
      HOME,
    );

    expect(env).toEqual({
      PATH: '/usr/bin',
      HOME,
      CLAUDE_CODE_OAUTH_TOKEN: 'oauth',
      DISABLE_AUTOUPDATER: '1',
    });
  });

  it('passes both credentials when both are set, since claude -p prefers the key', () => {
    const env = claudeEnv(
      {
        PATH: '/usr/bin',
        CLAUDE_CODE_OAUTH_TOKEN: 'oauth',
        ANTHROPIC_API_KEY: 'key',
      },
      HOME,
    );

    expect(env).toEqual({
      PATH: '/usr/bin',
      HOME,
      CLAUDE_CODE_OAUTH_TOKEN: 'oauth',
      ANTHROPIC_API_KEY: 'key',
      DISABLE_AUTOUPDATER: '1',
    });
  });

  it('omits a credential that is empty, never passing undefined', () => {
    const env = claudeEnv(
      {
        PATH: '/usr/bin',
        CLAUDE_CODE_OAUTH_TOKEN: '',
        ANTHROPIC_API_KEY: 'key',
      },
      HOME,
    );

    expect(env).not.toHaveProperty('CLAUDE_CODE_OAUTH_TOKEN');
    expect(env).toEqual({
      PATH: '/usr/bin',
      HOME,
      ANTHROPIC_API_KEY: 'key',
      DISABLE_AUTOUPDATER: '1',
    });
  });

  it('throws ProviderUnavailableError when neither credential is set', () => {
    expect(() => claudeEnv({ PATH: '/usr/bin' }, HOME)).toThrow(
      ProviderUnavailableError,
    );
    expect(() => claudeEnv({ PATH: '/usr/bin' }, HOME)).toThrow(
      'no Claude credential',
    );
  });

  it('treats empty credentials as unset', () => {
    expect(() =>
      claudeEnv(
        {
          PATH: '/usr/bin',
          CLAUDE_CODE_OAUTH_TOKEN: '',
          ANTHROPIC_API_KEY: '',
        },
        HOME,
      ),
    ).toThrow(ProviderUnavailableError);
  });
});
