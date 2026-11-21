import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { AdminAccess } from './admin-access';
import { AdminGuard } from './admin.guard';

const guardFor = (admins: string[] | undefined) =>
  new AdminGuard(
    new AdminAccess({
      get: () => admins,
    } as unknown as ConfigService<{ ADMIN_USERS?: string[] }, true>),
  );

const contextFor = (userId: string | undefined) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ userId }) }),
  }) as unknown as ExecutionContext;

describe('AdminGuard', () => {
  it('lets a listed user through', () => {
    expect(guardFor(['a', 'b']).canActivate(contextFor('b'))).toBe(true);
  });

  it('forbids a user who is not listed', () => {
    expect(() => guardFor(['a']).canActivate(contextFor('c'))).toThrow(
      ForbiddenException,
    );
  });

  it('lets nobody through when the setting is empty or unset', () => {
    expect(() => guardFor([]).canActivate(contextFor('a'))).toThrow(
      ForbiddenException,
    );
    expect(() => guardFor(undefined).canActivate(contextFor('a'))).toThrow(
      ForbiddenException,
    );
  });

  it('forbids a request without a user id', () => {
    expect(() => guardFor(['a']).canActivate(contextFor(undefined))).toThrow(
      ForbiddenException,
    );
  });
});
