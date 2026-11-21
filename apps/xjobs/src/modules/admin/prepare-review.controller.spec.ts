import { ValidationPipe, type ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { Response } from 'express';
import { UserGuard } from 'src/common/guards';
import { AdminAccess } from './admin-access';
import { AdminGuard } from './admin.guard';
import { DropsQueryDto, SilenceAuthorDto } from './dto/prepare-review.dto';
import { PrepareReviewController } from './prepare-review.controller';
import type { PrepareReviewService } from './prepare-review.service';

const access = (admins: string[]) =>
  ({ isAdmin: (id: string) => admins.includes(id) }) as unknown as AdminAccess;

const make = (
  service: Partial<PrepareReviewService> = {},
  admins = ['admin'],
) =>
  new PrepareReviewController(
    access(admins),
    service as unknown as PrepareReviewService,
  );

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

const res = () => {
  const status = vi.fn();
  return { status, response: { status } as unknown as Response };
};

describe('PrepareReviewController', () => {
  it('puts UserGuard on the class and AdminGuard on every route but /me', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, PrepareReviewController),
    ).toEqual([UserGuard]);
    const proto = PrepareReviewController.prototype;
    const guarded = (name: keyof PrepareReviewController) =>
      Reflect.getMetadata(GUARDS_METADATA, proto[name]) as
        | unknown[]
        | undefined;
    expect(guarded('me')).toBeUndefined();
    for (const name of [
      'drops',
      'silencedPosts',
      'silencedAuthors',
      'silence',
      'unsilence',
    ] as const)
      expect(guarded(name)).toContain(AdminGuard);
  });

  it('answers /me from the admin list', () => {
    expect(make().me('admin')).toEqual({ admin: true });
    expect(make().me('someone')).toEqual({ admin: false });
  });

  it('403s a non-admin on every admin route through the real guard', () => {
    const guard = new AdminGuard(access(['admin']));
    const context = (userId: string) =>
      ({
        switchToHttp: () => ({ getRequest: () => ({ userId }) }),
      }) as unknown as ExecutionContext;
    expect(() => guard.canActivate(context('other'))).toThrow(
      expect.objectContaining({ status: 403 }),
    );
    expect(guard.canActivate(context('admin'))).toBe(true);
  });

  it('passes the drop filters, defaulting the limit to 50', async () => {
    const drops = vi.fn().mockResolvedValue({ items: [], next: null });
    const controller = make({ drops });
    await controller.drops({});
    expect(drops).toHaveBeenLastCalledWith({
      rule: null,
      before: null,
      limit: 50,
    });
    await controller.drops({ rule: 'no-text', before: 'c', limit: 5 });
    expect(drops).toHaveBeenLastCalledWith({
      rule: 'no-text',
      before: 'c',
      limit: 5,
    });
  });

  it.each([{ limit: '0' }, { limit: '201' }, { limit: 'x' }, { limit: '1.5' }])(
    'rejects the drops query %j with 400',
    async (query) => {
      await expect(
        pipe.transform(query, { type: 'query', metatype: DropsQueryDto }),
      ).rejects.toMatchObject({ status: 400 });
    },
  );

  it('coerces a numeric limit string', async () => {
    await expect(
      pipe.transform(
        { limit: '200', rule: 'r' },
        { type: 'query', metatype: DropsQueryDto },
      ),
    ).resolves.toMatchObject({ limit: 200, rule: 'r' });
  });

  it.each([
    {},
    { authorKey: 'profile:a' },
    { authorKey: 'profile:a', reason: '' },
    { authorKey: 'nope', reason: 'x' },
    { authorKey: 'profile:', reason: 'x' },
    { authorKey: 'user:a', reason: 'x' },
    { authorKey: 'profile:a', reason: 'x', extra: 1 },
  ])('rejects the silence body %j with 400', async (body) => {
    await expect(
      pipe.transform(body, { type: 'body', metatype: SilenceAuthorDto }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('silences as the admin: 201 when new, 200 when already', async () => {
    const silence = vi
      .fn()
      .mockResolvedValueOnce('silenced')
      .mockResolvedValueOnce('already');
    const controller = make({ silence });
    const first = res();
    await expect(
      controller.silence(
        'admin',
        { authorKey: 'company:acme', reason: 'agency' },
        first.response,
      ),
    ).resolves.toEqual({ status: 'silenced' });
    expect(first.status).toHaveBeenCalledWith(201);
    expect(silence).toHaveBeenCalledWith('admin', {
      authorKey: 'company:acme',
      name: null,
      reason: 'agency',
    });
    const second = res();
    await expect(
      controller.silence(
        'admin',
        { authorKey: 'company:acme', name: 'Acme', reason: 'agency' },
        second.response,
      ),
    ).resolves.toEqual({ status: 'already' });
    expect(second.status).toHaveBeenCalledWith(200);
  });

  it('unsilences an encoded-then-decoded key and 404s one that is not silenced', async () => {
    const unsilence = vi.fn().mockResolvedValue(undefined);
    await make({ unsilence }).unsilence('profile:jane');
    expect(unsilence).toHaveBeenCalledWith('profile:jane');
    const missing = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('x'), { status: 404 }));
    await expect(
      make({ unsilence: missing }).unsilence('profile:z'),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('answers 400 for a bad key without touching the service', async () => {
    const unsilence = vi.fn();
    await expect(make({ unsilence }).unsilence('jane')).rejects.toMatchObject({
      status: 400,
    });
    expect(unsilence).not.toHaveBeenCalled();
  });
});
