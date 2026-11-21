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

  it('serves empty pages to an admin', async () => {
    expect(await (await call('/prepare/drops', 'admin')).json()).toEqual({
      items: [],
      next: null,
    });
    expect(
      await (await call('/prepare/silenced-posts', 'admin')).json(),
    ).toEqual({ items: [], next: null });
  });
});
