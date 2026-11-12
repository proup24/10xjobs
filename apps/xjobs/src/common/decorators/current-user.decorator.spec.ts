import { InternalServerErrorException } from '@nestjs/common';
import { currentUserId } from './current-user.decorator';

const contextFor = (request: object) =>
  ({ switchToHttp: () => ({ getRequest: () => request }) }) as never;

describe('currentUserId', () => {
  it('returns the user id the guard set', () => {
    expect(currentUserId(contextFor({ userId: 'u-1' }))).toBe('u-1');
  });

  it.each([undefined, null, 42])(
    'throws a generic 500 when userId is %s (a route forgot UserGuard)',
    (userId) => {
      expect(() => currentUserId(contextFor({ userId }))).toThrow(
        InternalServerErrorException,
      );
    },
  );
});
