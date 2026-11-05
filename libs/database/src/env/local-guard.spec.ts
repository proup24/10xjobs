import { assertLocalDatabase, isLocalUrl } from './local-guard';

describe('isLocalUrl', () => {
  it.each([
    'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    'postgresql://u:p@localhost:5432/db',
    'http://[::1]:54321',
  ])('treats %s as local', (url) => expect(isLocalUrl(url)).toBe(true));

  it('treats a pooler URL as remote', () =>
    expect(
      isLocalUrl(
        'postgresql://postgres.ref:pw@aws-0-eu-west-1.pooler.supabase.com:5432/postgres',
      ),
    ).toBe(false));
});

describe('assertLocalDatabase', () => {
  const remote = 'postgresql://u:secret@db.example.com:5432/x';

  it('refuses a remote URL and names the variable and host', () =>
    expect(() => assertLocalDatabase({ DATABASE_URL: remote }, {})).toThrow(
      /DATABASE_URL.*db\.example\.com.*XJOBS_ALLOW_REMOTE_DB=1/,
    ));

  it('never prints the password', () =>
    expect(() => assertLocalDatabase({ DATABASE_URL: remote }, {})).not.toThrow(
      /secret/,
    ));

  it('allows a remote URL with XJOBS_ALLOW_REMOTE_DB=1', () =>
    expect(() =>
      assertLocalDatabase(
        { DATABASE_URL: remote },
        { XJOBS_ALLOW_REMOTE_DB: '1' },
      ),
    ).not.toThrow());

  it('ignores undefined URLs', () =>
    expect(() =>
      assertLocalDatabase({ DIRECT_DATABASE_URL: undefined }, {}),
    ).not.toThrow());
});
