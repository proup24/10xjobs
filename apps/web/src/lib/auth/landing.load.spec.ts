// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { fakeSupabase } from '@/test/fake-supabase';
import { landingPath } from './landing';

// No mock of loadSetupSnapshot here: landingPath runs over a fake client.
describe('landingPath with the real snapshot load', () => {
  it('sends a finished user whose oldest profile has no resume but a newer one has to /', async () => {
    const f = fakeSupabase({
      reply(call) {
        if (call.table === 'users') {
          return {
            data: {
              name: 'Ada',
              residenceCountry: 'DE',
              acceptsSponsorship: false,
            },
            error: null,
          };
        }
        if (call.table === 'profiles') {
          return {
            data: [
              { id: 'p1', resumeKey: null },
              { id: 'p2', resumeKey: 'u1/p2/cv.pdf' },
            ],
            error: null,
          };
        }
        return undefined;
      },
    });
    expect(await landingPath(f.supabase)).toBe('/');
  });
});
