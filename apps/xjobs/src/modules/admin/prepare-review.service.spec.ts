import type { SilencedAuthorsRepository } from 'src/modules/ingest/repositories/silenced-authors.repository';
import type {
  DropRow,
  PrepareReviewRepository,
} from './prepare-review.repository';
import {
  decodeDropCursor,
  encodeDropCursor,
  parseDropReason,
  PrepareReviewService,
} from './prepare-review.service';

const ID = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const row = (n: number, reason: string): DropRow => ({
  rawItemId: ID(n),
  reason,
  lastSeenAt: new Date(Date.UTC(2026, 10, 21, 10, 0, 60 - n)),
  payload: {
    id: `p${n}`,
    url: `https://www.linkedin.com/posts/p${n}`,
    content: 'text',
    postedAt: { date: '2026-11-20T10:00:00Z' },
    author: {
      type: 'profile',
      publicIdentifier: 'Jane',
      name: 'Jane',
      info: 'Recruiter',
      linkedinUrl: 'https://www.linkedin.com/in/jane',
    },
  },
});

function service(
  review: Partial<PrepareReviewRepository>,
  silenced: Partial<SilencedAuthorsRepository> = {},
) {
  return new PrepareReviewService(
    review as PrepareReviewRepository,
    silenced as SilencedAuthorsRepository,
  );
}

describe('parseDropReason', () => {
  it.each([
    ['prepare: no-text', 'no-text', null],
    ['prepare: hiring-us: "we are hiring"', 'hiring-us', 'we are hiring'],
    ['prepare: r: "she said "hi" to me"', 'r', 'she said "hi" to me'],
    ['prepare: r: ""', 'r', ''],
    ['normalize: post has no id or link', null, null],
    ['something else', null, null],
  ])('%s', (reason, rule, match) => {
    expect(parseDropReason(reason)).toEqual({ rule, match });
  });
});

describe('drop cursor', () => {
  it('round-trips', () => {
    const at = new Date('2026-11-21T10:00:00.123Z');
    expect(
      decodeDropCursor(encodeDropCursor({ lastSeenAt: at, id: ID(1) })),
    ).toEqual({ lastSeenAt: at.toISOString(), id: ID(1) });
  });

  it.each(['', '!!!', 'bm9wZQ', Buffer.from('a|b').toString('base64url')])(
    'rejects %j',
    (cursor) => {
      expect(decodeDropCursor(cursor)).toBeNull();
    },
  );
});

describe('PrepareReviewService', () => {
  it('pages drops, shaping each from its payload, with a next cursor', async () => {
    const rows = [
      row(3, 'prepare: no-text'),
      row(2, 'prepare: agency: "we place"'),
      row(1, 'normalize: post has no id or link'),
    ];
    const drops = vi.fn().mockResolvedValue(rows);
    const page = await service({ drops }).drops({
      rule: null,
      before: null,
      limit: 2,
    });
    expect(drops).toHaveBeenCalledWith({ rule: null, before: null, limit: 3 });
    expect(page.items).toHaveLength(2);
    expect(page.items[1]).toEqual({
      rawItemId: ID(2),
      reason: 'prepare: agency: "we place"',
      rule: 'agency',
      match: 'we place',
      postedAt: '2026-11-20T10:00:00.000Z',
      url: 'https://www.linkedin.com/posts/p2',
      author: {
        key: 'profile:jane',
        name: 'Jane',
        headline: 'Recruiter',
        profileUrl: 'https://www.linkedin.com/in/jane',
      },
    });
    expect(decodeDropCursor(page.next!)).toEqual({
      lastSeenAt: rows[1]!.lastSeenAt.toISOString(),
      id: ID(2),
    });
  });

  it('shows a non-prepare drop with a null rule, and no next on the last page', async () => {
    const drops = vi
      .fn()
      .mockResolvedValue([row(1, 'normalize: post has no id or link')]);
    const page = await service({ drops }).drops({
      rule: null,
      before: null,
      limit: 2,
    });
    expect(page.items[0]).toMatchObject({ rule: null, match: null });
    expect(page.next).toBeNull();
  });

  it.each(['javascript:alert(1)', 'data:text/html,<b>x</b>', 'not a url'])(
    'gives a null url for a payload url that is not http(s): %s',
    async (url) => {
      const bad = row(1, 'prepare: no-text');
      bad.payload = { ...(bad.payload as object), url };
      const drops = vi.fn().mockResolvedValue([bad]);
      const page = await service({ drops }).drops({
        rule: null,
        before: null,
        limit: 5,
      });
      expect(page.items[0].url).toBeNull();
    },
  );

  it('answers 400 for a garbage cursor', async () => {
    const drops = vi.fn();
    await expect(
      service({ drops }).drops({ rule: null, before: 'garbage', limit: 5 }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service({}, { silencedPostJobIds: vi.fn() }).silencedPosts({
        before: 'garbage',
        limit: 5,
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(drops).not.toHaveBeenCalled();
  });

  it('pages held posts by job id', async () => {
    const silencedPostJobIds = vi.fn().mockResolvedValue([ID(9), ID(8), ID(7)]);
    const heldPosts = vi.fn().mockResolvedValue([
      {
        jobId: ID(9),
        postingUrl: 'https://x/9',
        post: {
          author: { key: 'profile:a', name: 'A' },
          postedAt: '2026-11-20T00:00:00.000Z',
        },
      },
      { jobId: ID(8), postingUrl: 'https://x/8', post: null },
    ]);
    const page = await service(
      { heldPosts },
      { silencedPostJobIds },
    ).silencedPosts({ before: null, limit: 2 });
    expect(silencedPostJobIds).toHaveBeenCalledWith({ before: null, limit: 3 });
    expect(heldPosts).toHaveBeenCalledWith([ID(9), ID(8)]);
    expect(page.next).toBe(ID(8));
    expect(page.items[0]).toEqual({
      jobId: ID(9),
      url: 'https://x/9',
      author: { key: 'profile:a', name: 'A', headline: null, profileUrl: null },
      postedAt: '2026-11-20T00:00:00.000Z',
    });
    expect(page.items[1]!.author.key).toBeNull();
  });

  it('silences manually, as the admin, with no evidence', async () => {
    const silence = vi.fn().mockResolvedValue('silenced');
    await service({}, { silence }).silence('admin', {
      authorKey: 'profile:a',
      name: null,
      reason: 'r',
    });
    expect(silence).toHaveBeenCalledWith({
      authorKey: 'profile:a',
      name: null,
      reason: 'r',
      origin: 'manual',
      evidence: null,
      createdBy: 'admin',
    });
  });

  it('round-trips: silence then delete; deleting again is a 404', async () => {
    const set = new Set<string>();
    const silenced = {
      silence: vi.fn(async (i: { authorKey: string }) => {
        if (set.has(i.authorKey)) return 'already' as const;
        set.add(i.authorKey);
        return 'silenced' as const;
      }),
      unsilence: vi.fn(async (k: string) => set.delete(k)),
    };
    const s = service({}, silenced);
    const input = { authorKey: 'profile:a', name: null, reason: 'r' };
    expect(await s.silence('admin', input)).toBe('silenced');
    expect(await s.silence('admin', input)).toBe('already');
    await expect(s.unsilence('profile:a')).resolves.toBeUndefined();
    await expect(s.unsilence('profile:a')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('lists silenced authors with ISO dates', async () => {
    const list = vi.fn().mockResolvedValue([
      {
        id: ID(1),
        authorKey: 'profile:a',
        name: null,
        reason: 'r',
        origin: 'manual',
        evidence: null,
        createdBy: null,
        createdAt: new Date('2026-11-21T10:00:00Z'),
      },
    ]);
    const [view] = await service({}, { list }).silencedAuthors();
    expect(view!.createdAt).toBe('2026-11-21T10:00:00.000Z');
  });
});
