// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const forward = vi.fn();

vi.mock('@/lib/engine/server', () => ({
  callbackEngineClient: () => ({ forwardWebhookCallback: forward }),
}));

const HEADERS = {
  'x-10xjobs-webhook': 'wh-1',
  'x-10xjobs-timestamp': '1800000000',
  'x-10xjobs-signature': 'sha256=abc',
  'content-type': 'application/json',
};

function call(body: BodyInit, headers: Record<string, string> = HEADERS) {
  return POST(
    new Request('http://localhost:3000/api/webhooks/callback', {
      method: 'POST',
      headers,
      body,
    }),
  );
}

describe('POST /api/webhooks/callback', () => {
  beforeEach(() => {
    forward.mockReset();
    forward.mockResolvedValue({ status: 200, body: '{"version":1}' });
  });

  it('forwards the raw bytes unchanged', async () => {
    const bytes = new TextEncoder().encode('{ "z":1,\n  "a" : "é"  }\r\n');
    await call(bytes);
    const input = forward.mock.calls[0][0];
    expect(Array.from(input.body)).toEqual(Array.from(bytes));
    expect(input.headers).toEqual({
      'x-10xjobs-webhook': 'wh-1',
      'x-10xjobs-timestamp': '1800000000',
      'x-10xjobs-signature': 'sha256=abc',
    });
    expect(input.contentType).toBe('application/json');
  });

  it("returns the engine's status and body", async () => {
    forward.mockResolvedValue({ status: 401, body: '{"code":"UNAUTHORIZED"}' });
    const res = await call('{}');
    expect(res.status).toBe(401);
    expect(await res.text()).toBe('{"code":"UNAUTHORIZED"}');
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  it('413 over 16 384 bytes without calling the engine', async () => {
    const res = await call('x'.repeat(16_385));
    expect(res.status).toBe(413);
    expect(forward).not.toHaveBeenCalled();
    const ok = await call('x'.repeat(16_384));
    expect(ok.status).toBe(200);
  });

  it('413 on a declared length over the cap, without reading the body', async () => {
    const res = await call('{}', { ...HEADERS, 'content-length': '99999' });
    expect(res.status).toBe(413);
    expect(forward).not.toHaveBeenCalled();
  });

  it('503 when the engine is unavailable', async () => {
    forward.mockResolvedValue({ kind: 'unavailable' });
    const res = await call('{}');
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ version: 1, error: 'unavailable' });
  });
});
