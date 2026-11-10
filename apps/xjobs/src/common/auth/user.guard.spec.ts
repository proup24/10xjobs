import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { UserGuard } from './user.guard';
import type { UserTokenVerifier } from './user-token.verifier';

const SUB = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';

function setup(verify = vi.fn().mockResolvedValue(SUB)) {
  const guard = new UserGuard({ verify } as unknown as UserTokenVerifier);
  const run = (authorization?: string) => {
    const request: { headers: Record<string, string>; userId?: string } = {
      headers: authorization === undefined ? {} : { authorization },
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    };
    return { request, result: guard.canActivate(context as never) };
  };
  return { verify, run };
}

describe('UserGuard', () => {
  it('sets userId from a valid bearer token', async () => {
    const { verify, run } = setup();
    const { request, result } = run('Bearer abc.def.ghi');
    await expect(result).resolves.toBe(true);
    expect(verify).toHaveBeenCalledWith('abc.def.ghi');
    expect(request.userId).toBe(SUB);
  });

  it('accepts lowercase bearer', async () => {
    const { run } = setup();
    await expect(run('bearer abc').result).resolves.toBe(true);
  });

  it.each([
    ['no header', undefined],
    ['Bearer with no token', 'Bearer '],
    ['Bearer  two-spaces', 'Bearer  abc'],
    ['Basic credentials', 'Basic dXNlcjpwYXNz'],
  ])('rejects %s with 401', async (_name, header) => {
    const { verify, run } = setup();
    await expect(run(header).result).rejects.toThrow(UnauthorizedException);
    expect(verify).not.toHaveBeenCalled();
  });

  it('passes a 503 from the verifier through unchanged', async () => {
    const error = new ServiceUnavailableException(
      'Authentication is unavailable',
    );
    const { run } = setup(vi.fn().mockRejectedValue(error));
    await expect(run('Bearer abc').result).rejects.toBe(error);
  });
});
