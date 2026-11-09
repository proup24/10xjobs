// @vitest-environment node
import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@xjobs/database/types';
import type { SetupSnapshot } from '@/lib/setup/next-step';
import { landingPath } from './landing';

const load = vi.hoisted(() => vi.fn());
vi.mock('@/lib/setup/load', () => ({ loadSetupSnapshot: load }));

const client = {} as SupabaseClient<Database>;
const base: SetupSnapshot = {
  name: 'Ada',
  residenceCountry: 'DE',
  acceptsSponsorship: false,
  draft: null,
  profile: { id: 'p1', hasResume: true },
};

beforeEach(() => load.mockReset());

describe('landingPath', () => {
  it('sends a new user to /setup', async () => {
    load.mockResolvedValue({
      ...base,
      name: null,
      residenceCountry: null,
      acceptsSponsorship: null,
      profile: null,
    });
    expect(await landingPath(client)).toBe('/setup');
  });

  it('sends a user with a profile but no resume to /setup', async () => {
    load.mockResolvedValue({
      ...base,
      profile: { id: 'p1', hasResume: false },
    });
    expect(await landingPath(client)).toBe('/setup');
  });

  it('sends a finished user whose oldest profile has no resume but a newer one has to /', async () => {
    // loadSetupSnapshot picks the first profile with a resume.
    load.mockResolvedValue({
      ...base,
      profile: { id: 'p2', hasResume: true },
    });
    expect(await landingPath(client)).toBe('/');
  });

  it('sends a user with a resume profile and a new-profile draft to /', async () => {
    load.mockResolvedValue({ ...base, draft: null });
    expect(await landingPath(client)).toBe('/');
  });

  it('sends a finished user to /', async () => {
    load.mockResolvedValue(base);
    expect(await landingPath(client)).toBe('/');
  });
});
