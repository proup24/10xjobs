import type { SeedEnvironmentVariables } from '../env';
import { assertSeedTargets } from './index';

const local = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const remote = 'postgresql://u:secret@db.example.com:5432/x';

function seedEnv(
  databaseUrl: string,
  supabaseUrl?: string,
): SeedEnvironmentVariables {
  return {
    DATABASE_URL: databaseUrl,
    SUPABASE_URL: supabaseUrl,
  } as SeedEnvironmentVariables;
}

describe('assertSeedTargets', () => {
  it('throws for a local DATABASE_URL with a remote SUPABASE_URL', () =>
    expect(() =>
      assertSeedTargets(seedEnv(local, 'https://abc.supabase.co'), {}),
    ).toThrow(/SUPABASE_URL.*abc\.supabase\.co/));

  it('throws for a remote DATABASE_URL with a local SUPABASE_URL', () =>
    expect(() =>
      assertSeedTargets(seedEnv(remote, 'http://127.0.0.1:54321'), {}),
    ).toThrow(/DATABASE_URL.*db\.example\.com/));

  it('passes when both are local', () =>
    expect(() =>
      assertSeedTargets(seedEnv(local, 'http://127.0.0.1:54321'), {}),
    ).not.toThrow());

  it('passes when both are remote with XJOBS_ALLOW_REMOTE_DB=1', () =>
    expect(() =>
      assertSeedTargets(seedEnv(remote, 'https://abc.supabase.co'), {
        XJOBS_ALLOW_REMOTE_DB: '1',
      }),
    ).not.toThrow());
});
