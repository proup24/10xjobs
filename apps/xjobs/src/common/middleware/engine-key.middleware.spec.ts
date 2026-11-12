import { ErrorCode } from '../enums';
import { ErrorResponseDto } from '../dtos';
import {
  ENGINE_KEY_HEADER,
  engineKeyMiddleware,
} from './engine-key.middleware';

const KEY = 'k'.repeat(40);

function run(header: string | string[] | undefined) {
  const request = {
    headers: header === undefined ? {} : { [ENGINE_KEY_HEADER]: header },
    traceId: 'trace-1',
  };
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
  };
  const next = vi.fn();
  engineKeyMiddleware(KEY)(request as never, res as never, next);
  return { res, next };
}

function expectRejected({ res, next }: ReturnType<typeof run>) {
  expect(next).not.toHaveBeenCalled();
  expect(res.status).toHaveBeenCalledWith(401);
  const body = res.json.mock.calls[0][0];
  expect(body).toEqual(
    ErrorResponseDto.of(
      ErrorCode.UNAUTHORIZED,
      'Authentication required',
      'trace-1',
    ),
  );
  expect(res.setHeader).not.toHaveBeenCalledWith(
    'WWW-Authenticate',
    expect.anything(),
  );
}

describe('engineKeyMiddleware', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls next for the right key', () => {
    const { res, next } = run(KEY);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('401s with no header', () => expectRejected(run(undefined)));
  it('401s a wrong key', () => expectRejected(run('x'.repeat(40))));
  it('401s a key differing only in length', () =>
    expectRejected(run(`${KEY}k`)));
  it('401s when the header arrives as an array', () =>
    expectRejected(run([KEY, KEY])));
});
