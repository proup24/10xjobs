// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createEngineClient, type EngineClientDeps } from './client';

const KEY = 'k'.repeat(40);
const TOKEN = 'secret.jwt.token';
const PID = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function setup(
  respond: () => Response | Promise<Response>,
  overrides: Partial<EngineClientDeps> = {},
) {
  const fetchMock = vi.fn<typeof fetch>(async () => respond());
  const log = vi.fn();
  const client = createEngineClient({
    url: 'http://engine.test',
    apiKey: KEY,
    accessToken: async () => TOKEN,
    fetch: fetchMock,
    log,
    ...overrides,
  });
  return { client, fetchMock, log };
}

describe('engine client publishProfile', () => {
  it('sends POST {url}/api/profiles/{id}/publish with X-Engine-Key and Bearer token', async () => {
    const { client, fetchMock } = setup(() =>
      json(200, { status: 'success', data: { id: PID, state: 'published' } }),
    );
    const result = await client.publishProfile(PID);
    expect(result).toEqual({
      kind: 'ok',
      data: { id: PID, state: 'published' },
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`http://engine.test/api/profiles/${PID}/publish`);
    expect(init?.method).toBe('POST');
    const headers = new Headers(init?.headers);
    expect(headers.get('x-engine-key')).toBe(KEY);
    expect(headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
  });

  it('401 → unauthorized', async () => {
    const { client } = setup(() => json(401, { code: 'UNAUTHORIZED' }));
    expect(await client.publishProfile(PID)).toEqual({ kind: 'unauthorized' });
  });

  it('404 → not-found', async () => {
    const { client } = setup(() => json(404, { code: 'NOT_FOUND' }));
    expect(await client.publishProfile(PID)).toEqual({ kind: 'not-found' });
  });

  it('409 PROFILE_PUBLISHED → conflict already-published', async () => {
    const { client } = setup(() => json(409, { code: 'PROFILE_PUBLISHED' }));
    expect(await client.publishProfile(PID)).toEqual({
      kind: 'conflict',
      reason: 'already-published',
    });
  });

  it('409 ELIGIBILITY_REQUIRED → conflict incomplete', async () => {
    const { client } = setup(() => json(409, { code: 'ELIGIBILITY_REQUIRED' }));
    expect(await client.publishProfile(PID)).toEqual({
      kind: 'conflict',
      reason: 'incomplete',
    });
  });

  it('409 with an unknown code → unavailable', async () => {
    const { client } = setup(() => json(409, { code: 'SOMETHING_ELSE' }));
    expect(await client.publishProfile(PID)).toEqual({ kind: 'unavailable' });
  });

  it('400 → invalid with the body message', async () => {
    const { client } = setup(() =>
      json(400, { code: 'BAD_REQUEST', message: 'profileId must be a UUID' }),
    );
    expect(await client.publishProfile(PID)).toEqual({
      kind: 'invalid',
      message: 'profileId must be a UUID',
    });
  });

  it('503 → unavailable', async () => {
    const { client } = setup(() => json(503, { code: 'SERVICE_UNAVAILABLE' }));
    expect(await client.publishProfile(PID)).toEqual({ kind: 'unavailable' });
  });

  it('network error → unavailable', async () => {
    const { client } = setup(() => {
      throw new TypeError('fetch failed');
    });
    expect(await client.publishProfile(PID)).toEqual({ kind: 'unavailable' });
  });

  it('502 with an HTML body → unavailable, no throw', async () => {
    const { client } = setup(
      () => new Response('<html>Bad Gateway</html>', { status: 502 }),
    );
    expect(await client.publishProfile(PID)).toEqual({ kind: 'unavailable' });
  });

  it('empty 200 body → unavailable', async () => {
    const { client } = setup(() => new Response('', { status: 200 }));
    expect(await client.publishProfile(PID)).toEqual({ kind: 'unavailable' });
  });

  it('aborts after timeoutMs → unavailable', async () => {
    const hanging = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(init.signal?.reason),
          );
        }),
    );
    const { client } = setup(() => json(200, {}), {
      fetch: hanging,
      timeoutMs: 10,
    });
    expect(await client.publishProfile(PID)).toEqual({ kind: 'unavailable' });
  });

  it('missing ENGINE_URL or key → unavailable without fetching', async () => {
    for (const overrides of [{ url: undefined }, { apiKey: undefined }]) {
      const { client, fetchMock } = setup(() => json(200, {}), overrides);
      expect(await client.publishProfile(PID)).toEqual({
        kind: 'unavailable',
      });
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  it('no session → unauthorized without fetching', async () => {
    const { client, fetchMock } = setup(() => json(200, {}), {
      accessToken: async () => null,
    });
    expect(await client.publishProfile(PID)).toEqual({ kind: 'unauthorized' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never logs the key or the token', async () => {
    const { client, log } = setup(() => json(401, { code: 'UNAUTHORIZED' }));
    await client.publishProfile(PID);
    expect(log).toHaveBeenCalledWith(
      `engine publishProfile profile=${PID} outcome=unauthorized status=401`,
    );
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).not.toContain(KEY);
    expect(logged).not.toContain(TOKEN);
  });

  it('a non-UUID profile id → not-found without fetching, and the raw value is not logged', async () => {
    const { client, fetchMock, log } = setup(() => json(200, {}));
    const raw = '../../etc/passwd?x=1';
    expect(await client.publishProfile(raw)).toEqual({ kind: 'not-found' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      'engine publishProfile profile=invalid outcome=not-found status=none',
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain('passwd');
  });
});

describe('engine client post search', () => {
  const view = { enabled: false, allowed: true, searches: 2 };

  it('sends GET …/api/profiles/{id}/post-search', async () => {
    const { client, fetchMock } = setup(() =>
      json(200, { status: 'success', data: view }),
    );
    expect(await client.postSearchStatus(PID)).toEqual({
      kind: 'ok',
      data: view,
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`http://engine.test/api/profiles/${PID}/post-search`);
    expect(init?.method).toBe('GET');
    const headers = new Headers(init?.headers);
    expect(headers.get('x-engine-key')).toBe(KEY);
    expect(headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
  });

  it('sends PUT with {"enabled":true}', async () => {
    const { client, fetchMock } = setup(() =>
      json(200, { status: 'success', data: { ...view, enabled: true } }),
    );
    expect(await client.setPostSearch(PID, true)).toEqual({
      kind: 'ok',
      data: { ...view, enabled: true },
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`http://engine.test/api/profiles/${PID}/post-search`);
    expect(init?.method).toBe('PUT');
    expect(init?.body).toBe('{"enabled":true}');
    expect(new Headers(init?.headers).get('content-type')).toBe(
      'application/json',
    );
  });

  it('maps 403 to forbidden', async () => {
    const { client } = setup(() =>
      json(403, { code: 'POST_SEARCH_NOT_ALLOWED' }),
    );
    expect(await client.setPostSearch(PID, true)).toEqual({
      kind: 'forbidden',
    });
  });
});
