// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { publishProfile } from './publish';

const P = '8f9c1a52-3b1e-4c7a-9d2e-1f0a2b3c4d5e';
const engine = (result: unknown) => ({
  publishProfile: vi.fn().mockResolvedValue(result),
});

describe('publishProfile', () => {
  it('maps ok to the matches view', async () => {
    expect(
      await publishProfile(engine({ kind: 'ok', value: {} }) as never, P),
    ).toEqual({
      status: 'published',
      href: `/?profile=${P}`,
    });
  });

  it('treats already-published as published', async () => {
    const r = await publishProfile(
      engine({ kind: 'conflict', reason: 'already-published' }) as never,
      P,
    );
    expect(r).toEqual({ status: 'published', href: `/?profile=${P}` });
  });

  it('maps incomplete to the eligibility message', async () => {
    const r = await publishProfile(
      engine({ kind: 'conflict', reason: 'incomplete' }) as never,
      P,
    );
    expect(r).toEqual({
      status: 'failed',
      message:
        'Set your country of residence and answer the visa sponsorship question in Eligibility, then finish again.',
    });
  });

  it.each([
    [{ kind: 'unavailable' }],
    [{ kind: 'not-found' }],
    [{ kind: 'unauthorized' }],
    [{ kind: 'conflict', reason: 'not-published' }],
  ])('maps %o to the generic message', async (result) => {
    expect(await publishProfile(engine(result) as never, P)).toEqual({
      status: 'failed',
      message: "Couldn't publish the profile. It's saved; try Finish again.",
    });
  });
});
