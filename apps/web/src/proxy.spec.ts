// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/session', () => ({ updateSession: vi.fn() }));

import { config } from './proxy';

// Next compiles a matcher source into an anchored regular expression.
const matcher = new RegExp(`^${config.matcher[0]}$`);

describe('proxy matcher', () => {
  it('leaves the webhook callback route out of the session proxy', () => {
    expect(matcher.test('/api/webhooks/callback')).toBe(false);
  });

  it('still matches other paths', () => {
    for (const path of ['/', '/matches', '/api/other', '/sign-in'])
      expect(matcher.test(path)).toBe(true);
  });
});
