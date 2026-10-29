import { traceIdMiddleware } from './trace-id.middleware';

function run(headers: Record<string, string>) {
  const request: { headers: Record<string, string>; traceId?: string } = {
    headers,
  };
  const set: Record<string, string> = {};
  const response = {
    setHeader: (name: string, value: string) => (set[name] = value),
  };
  let called = false;
  traceIdMiddleware(request as never, response as never, () => (called = true));
  return { request, set, called };
}

describe('traceIdMiddleware', () => {
  it('reuses a well-formed incoming request id', () => {
    const { request, set, called } = run({ 'x-request-id': 'abc-123' });
    expect(request.traceId).toBe('abc-123');
    expect(set['X-Trace-Id']).toBe('abc-123');
    expect(called).toBe(true);
  });

  it('generates a UUID when none is sent', () => {
    const { request } = run({});
    expect(request.traceId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('replaces a malformed incoming id', () => {
    const { request } = run({ 'x-trace-id': 'bad id\r\nSet-Cookie: x' });
    expect(request.traceId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
