import { ConflictException } from '@nestjs/common';
import { publishDrafts } from './publish-drafts';

const drafts = [
  { id: 'p1', userId: 'u1' },
  { id: 'p2', userId: 'u1' },
  { id: 'p3', userId: 'u2' },
];

describe('publishDrafts', () => {
  it('publishes drafts with a resume and skips the rest; dry run publishes none', async () => {
    const publish = vi.fn(async (_userId: string, profileId: string) => {
      if (profileId === 'p2')
        throw new ConflictException({ code: 'ELIGIBILITY_REQUIRED' });
      return { id: profileId };
    });
    const list = vi.fn(async () => drafts);

    const done = await publishDrafts({ listDrafts: list, publish });
    expect(publish.mock.calls).toEqual([
      ['u1', 'p1'],
      ['u1', 'p2'],
      ['u2', 'p3'],
    ]);
    expect(done).toEqual({
      published: 2,
      failed: 1,
      outcomes: [
        { id: 'p1', outcome: 'published' },
        { id: 'p2', outcome: 'ELIGIBILITY_REQUIRED' },
        { id: 'p3', outcome: 'published' },
      ],
    });

    publish.mockClear();
    const dry = await publishDrafts(
      { listDrafts: list, publish },
      { dryRun: true },
    );
    expect(publish).not.toHaveBeenCalled();
    expect(dry).toEqual({
      published: 0,
      failed: 0,
      outcomes: drafts.map(({ id }) => ({ id, outcome: 'would publish' })),
    });
  });
});
