import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Public } from '../decorators';
import { BasicAuthGuard } from './basic.guard';

const credentials = { username: 'admin', password: 'correct horse battery' };

class OpenController {
  @Public()
  health() {
    return 'ok';
  }

  secret() {
    return 'secret';
  }
}

function contextFor(
  authorization: string | undefined,
  handler = OpenController.prototype.secret,
) {
  const headers: Record<string, string> = {};
  const context = {
    getHandler: () => handler,
    getClass: () => OpenController,
    switchToHttp: () => ({
      getRequest: () => ({ headers: authorization ? { authorization } : {} }),
      getResponse: () => ({
        setHeader: (name: string, value: string) => (headers[name] = value),
      }),
    }),
  } as unknown as ExecutionContext;
  return { context, headers };
}

const basic = (user: string, pass: string) =>
  `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;

describe('BasicAuthGuard', () => {
  const guard = new BasicAuthGuard(new Reflector(), credentials);

  it('lets the right credentials through', () => {
    const { context } = contextFor(basic('admin', 'correct horse battery'));
    expect(guard.canActivate(context)).toBe(true);
  });

  it('accepts a password that contains a colon', () => {
    const withColon = new BasicAuthGuard(new Reflector(), {
      username: 'admin',
      password: 'pa:ss:word-long',
    });
    const { context } = contextFor(basic('admin', 'pa:ss:word-long'));
    expect(withColon.canActivate(context)).toBe(true);
  });

  it.each([
    ['no header', undefined],
    ['a wrong password', basic('admin', 'wrong')],
    ['a wrong username', basic('root', 'correct horse battery')],
    ['another scheme', 'Bearer abc'],
    ['malformed base64', 'Basic %%%'],
    ['no colon', `Basic ${Buffer.from('admin').toString('base64')}`],
  ])('rejects %s with a Basic challenge', (_case, authorization) => {
    const { context, headers } = contextFor(authorization);
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    expect(headers['WWW-Authenticate']).toBe(
      'Basic realm="10xjobs", charset="UTF-8"',
    );
  });

  it('skips @Public() handlers', () => {
    const { context } = contextFor(undefined, OpenController.prototype.health);
    expect(guard.canActivate(context)).toBe(true);
  });
});
