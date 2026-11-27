import { ValidationPipe, type ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { UserGuard } from 'src/common/guards';
import { AdminAccess } from './admin-access';
import { AdminGuard } from './admin.guard';
import { RescuesController, RescuesQueryDto } from './rescues.controller';
import type { RescuesRepository } from './rescues.repository';

const access = (admins: string[]) =>
  ({ isAdmin: (id: string) => admins.includes(id) }) as unknown as AdminAccess;

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

describe('RescuesController', () => {
  it('guards the route with UserGuard and AdminGuard', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, RescuesController)).toEqual([
      UserGuard,
    ]);
    expect(
      Reflect.getMetadata(GUARDS_METADATA, RescuesController.prototype.list),
    ).toContain(AdminGuard);
  });

  it('403s a non-admin through the real guard', () => {
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

  it('defaults the limit to 100 and returns the rows with ISO dates', async () => {
    const list = vi.fn().mockResolvedValue([
      {
        id: 'r1',
        createdAt: new Date('2026-11-27T10:00:00Z'),
        undoneAt: null,
        origin: 'junk',
        note: 'n',
        snapshot: { a: 1 },
        job: { id: 'j', kind: 'post', title: 't', postingUrl: 'https://x.y' },
        user: { id: 'u' },
      },
    ]);
    const controller = new RescuesController({
      list,
    } as unknown as RescuesRepository);
    const body = await controller.list({});
    expect(list).toHaveBeenCalledWith(100);
    expect(body.items[0]).toMatchObject({
      id: 'r1',
      createdAt: '2026-11-27T10:00:00.000Z',
      undoneAt: null,
      note: 'n',
    });
    await controller.list({ limit: 5 });
    expect(list).toHaveBeenLastCalledWith(5);
  });

  it('rejects a limit above 200 or below 1', async () => {
    const check = (limit: string) =>
      pipe.transform({ limit }, { type: 'query', metatype: RescuesQueryDto });
    await expect(check('201')).rejects.toThrow();
    await expect(check('0')).rejects.toThrow();
    await expect(check('200')).resolves.toMatchObject({ limit: 200 });
  });
});
