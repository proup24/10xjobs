import {
  type CanActivate,
  type ExecutionContext,
  type INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { UserGuard } from 'src/common/guards';
import { SilencedAuthorsRepository } from 'src/modules/ingest/repositories/silenced-authors.repository';
import { AdminAccess } from './admin-access';
import { PrepareReviewController } from './prepare-review.controller';
import { PrepareReviewRepository } from './prepare-review.repository';
import { PrepareReviewService } from './prepare-review.service';

/** Takes the token as the user id: `Bearer admin` or `Bearer other`. */
class TokenIsUser implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    request.userId = String(request.headers.authorization).slice(7);
    return true;
  }
}

describe('admin routes over HTTP', () => {
  let app: INestApplication;
  let base: string;
  const set = new Set<string>();
  const silenced = {
    list: vi.fn().mockResolvedValue([]),
    silence: vi.fn(async (input: { authorKey: string }) => {
      if (set.has(input.authorKey)) return 'already';
      set.add(input.authorKey);
      return 'silenced';
    }),
    unsilence: vi.fn(async (key: string) => set.delete(key)),
    silencedPostJobIds: vi.fn().mockResolvedValue([]),
  };
  const review = {
    drops: vi.fn().mockResolvedValue([]),
    heldPosts: vi.fn().mockResolvedValue([]),
    verdicts: vi.fn().mockResolvedValue([]),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [PrepareReviewController],
      providers: [
        PrepareReviewService,
        { provide: PrepareReviewRepository, useValue: review },
        { provide: SilencedAuthorsRepository, useValue: silenced },
        {
          provide: AdminAccess,
          useValue: { isAdmin: (id: string) => id === 'admin' },
        },
      ],
    })
      .overrideGuard(UserGuard)
      .useClass(TokenIsUser)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.listen(0, '127.0.0.1');
    base = `${await app.getUrl()}/api/admin`;
  });
  afterAll(async () => {
    await app?.close();
  });

  const call = (
    path: string,
    user: string,
    init: { method?: string; body?: unknown } = {},
  ) =>
    fetch(`${base}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        authorization: `Bearer ${user}`,
        'content-type': 'application/json',
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });

  it('answers /me for anyone', async () => {
    expect(await (await call('/me', 'admin')).json()).toEqual({ admin: true });
    expect(await (await call('/me', 'other')).json()).toEqual({ admin: false });
  });

  it.each([
    ['GET', '/prepare/drops'],
    ['GET', '/prepare/silenced-posts'],
    ['GET', '/extract/verdicts'],
    ['GET', '/silenced-authors'],
    ['POST', '/silenced-authors'],
    ['DELETE', '/silenced-authors/profile%3Ajane'],
  ])('403s a non-admin on %s %s', async (method, path) => {
    const body =
      method === 'POST' ? { authorKey: 'profile:a', reason: 'r' } : undefined;
    silenced.silence.mockClear();
    silenced.unsilence.mockClear();
    expect((await call(path, 'other', { method, body })).status).toBe(403);
    // 403 with no write.
    expect(silenced.silence).not.toHaveBeenCalled();
    expect(silenced.unsilence).not.toHaveBeenCalled();
  });

  it('round-trips silence and delete with an encoded key', async () => {
    const body = { authorKey: 'profile:jane', reason: 'agency' };
    expect(
      (await call('/silenced-authors', 'admin', { method: 'POST', body }))
        .status,
    ).toBe(201);
    const again = await call('/silenced-authors', 'admin', {
      method: 'POST',
      body,
    });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ status: 'already' });
    expect(silenced.silence).toHaveBeenLastCalledWith({
      authorKey: 'profile:jane',
      name: null,
      reason: 'agency',
      origin: 'manual',
      evidence: null,
      createdBy: 'admin',
    });
    const del = await call('/silenced-authors/profile%3Ajane', 'admin', {
      method: 'DELETE',
    });
    expect(del.status).toBe(204);
    expect(silenced.unsilence).toHaveBeenLastCalledWith('profile:jane');
    expect(
      (
        await call('/silenced-authors/profile%3Ajane', 'admin', {
          method: 'DELETE',
        })
      ).status,
    ).toBe(404);
  });

  it('400s a bad key, a missing reason and a garbage cursor', async () => {
    for (const body of [
      { authorKey: 'jane', reason: 'r' },
      { authorKey: 'profile:jane', reason: '' },
    ])
      expect(
        (await call('/silenced-authors', 'admin', { method: 'POST', body }))
          .status,
      ).toBe(400);
    expect(
      (await call('/silenced-authors/jane', 'admin', { method: 'DELETE' }))
        .status,
    ).toBe(400);
    expect((await call('/prepare/drops?before=zzz', 'admin')).status).toBe(400);
    expect((await call('/prepare/drops?limit=0', 'admin')).status).toBe(400);
    expect((await call('/prepare/drops?limit=201', 'admin')).status).toBe(400);
  });

  it('400s a verdict, reason or cursor the verdict list does not know', async () => {
    for (const query of [
      'verdict=hiring',
      'verdict=spam',
      'reason=hiring',
      'reason=bogus',
      'before=zzz',
      'limit=0',
    ])
      expect((await call(`/extract/verdicts?${query}`, 'admin')).status).toBe(
        400,
      );
  });

  it('lists a junk post with its reason, quote and original author', async () => {
    const extractedAt = new Date('2026-11-22T09:00:00.000Z');
    const source = (over: Record<string, unknown>) => ({
      id: 'p1',
      url: 'https://www.linkedin.com/posts/p1',
      author: {
        key: 'profile:sharer',
        name: 'Sam Sharer',
        profileUrl: null,
        headline: 'Sharer',
        type: 'person',
      },
      text: 'look',
      truncated: false,
      attachedUrls: [],
      postedAt: '2026-11-21T08:00:00.000Z',
      original: null,
      links: { emails: [], linkedinJobIds: [], atsPostings: [], other: [] },
      ...over,
    });
    review.verdicts.mockResolvedValueOnce([
      {
        jobId: '00000000-0000-7000-8000-000000000002',
        postingUrl: 'https://www.linkedin.com/posts/p1',
        verdict: 'junk',
        reason: 'funnel',
        confidence: 'sure',
        quote: 'Join my group for jobs',
        source: source({}),
        extractedAt,
      },
      {
        jobId: '00000000-0000-7000-8000-000000000001',
        postingUrl: 'https://www.linkedin.com/posts/p0',
        verdict: 'not_hiring',
        reason: 'open_to_work',
        confidence: 'unsure',
        quote: 'I am open to work',
        source: source({
          original: {
            id: 'p0',
            url: null,
            author: {
              key: 'profile:jane',
              name: 'Jane Doe',
              profileUrl: 'https://www.linkedin.com/in/jane',
              headline: 'Engineer',
              type: 'person',
            },
            text: 'open to work',
            truncated: false,
            attachedUrls: [],
            postedAt: '2026-11-20T08:00:00.000Z',
          },
        }),
        extractedAt,
      },
      {
        jobId: '00000000-0000-7000-8000-000000000000',
        postingUrl: 'https://www.linkedin.com/posts/px',
        verdict: 'junk',
        reason: 'other',
        confidence: 'sure',
        quote: '',
        source: null,
        extractedAt,
      },
    ]);
    const res = await call(
      '/extract/verdicts?verdict=junk&reason=funnel&limit=2',
      'admin',
    );
    expect(res.status).toBe(200);
    expect(review.verdicts).toHaveBeenLastCalledWith({
      verdict: 'junk',
      reason: 'funnel',
      before: null,
      limit: 3,
    });
    const body = (await res.json()) as { items: unknown[]; next: string };
    expect(body.items).toEqual([
      {
        jobId: '00000000-0000-7000-8000-000000000002',
        verdict: 'junk',
        reason: 'funnel',
        quote: 'Join my group for jobs',
        confidence: 'sure',
        author: {
          key: 'profile:sharer',
          name: 'Sam Sharer',
          headline: 'Sharer',
          profileUrl: null,
        },
        postedAt: '2026-11-21T08:00:00.000Z',
        url: 'https://www.linkedin.com/posts/p1',
        extractedAt: '2026-11-22T09:00:00.000Z',
      },
      {
        jobId: '00000000-0000-7000-8000-000000000001',
        verdict: 'not_hiring',
        reason: 'open_to_work',
        quote: 'I am open to work',
        confidence: 'unsure',
        // A share shows the original's author, never the sharer.
        author: {
          key: 'profile:jane',
          name: 'Jane Doe',
          headline: 'Engineer',
          profileUrl: 'https://www.linkedin.com/in/jane',
        },
        postedAt: '2026-11-20T08:00:00.000Z',
        url: 'https://www.linkedin.com/posts/p0',
        extractedAt: '2026-11-22T09:00:00.000Z',
      },
    ]);
    expect(typeof body.next).toBe('string');
    await call(`/extract/verdicts?before=${body.next}`, 'admin');
    expect(review.verdicts).toHaveBeenLastCalledWith({
      verdict: null,
      reason: null,
      before: {
        lastSeenAt: '2026-11-22T09:00:00.000Z',
        id: '00000000-0000-7000-8000-000000000001',
      },
      limit: 51,
    });
  });

  it('serves empty pages to an admin', async () => {
    expect(await (await call('/prepare/drops', 'admin')).json()).toEqual({
      items: [],
      next: null,
    });
    expect(
      await (await call('/prepare/silenced-posts', 'admin')).json(),
    ).toEqual({ items: [], next: null });
    expect(await (await call('/extract/verdicts', 'admin')).json()).toEqual({
      items: [],
      next: null,
    });
  });
});
