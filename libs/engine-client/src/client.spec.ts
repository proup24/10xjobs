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

describe('engine client deleteProfile', () => {
  it('sends DELETE {url}/api/profiles/{id} with X-Engine-Key and Bearer token', async () => {
    const { client, fetchMock, log } = setup(() =>
      json(200, { status: 'success', data: { id: PID } }),
    );
    expect(await client.deleteProfile(PID)).toEqual({
      kind: 'ok',
      data: { id: PID },
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`http://engine.test/api/profiles/${PID}`);
    expect(init?.method).toBe('DELETE');
    const headers = new Headers(init?.headers);
    expect(headers.get('x-engine-key')).toBe(KEY);
    expect(headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(log).toHaveBeenCalledWith(
      `engine deleteProfile profile=${PID} outcome=ok status=200`,
    );
  });

  it('401 → unauthorized, 404 → not-found, 400 → invalid', async () => {
    expect(
      await setup(() =>
        json(401, { code: 'UNAUTHORIZED' }),
      ).client.deleteProfile(PID),
    ).toEqual({ kind: 'unauthorized' });
    expect(
      await setup(() => json(404, { code: 'NOT_FOUND' })).client.deleteProfile(
        PID,
      ),
    ).toEqual({ kind: 'not-found' });
    expect(
      await setup(() => json(400, { message: 'bad' })).client.deleteProfile(
        PID,
      ),
    ).toEqual({ kind: 'invalid', message: 'bad' });
  });

  it('409 PROFILE_NOT_PUBLISHED → conflict not-published', async () => {
    const { client } = setup(() =>
      json(409, { code: 'PROFILE_NOT_PUBLISHED' }),
    );
    expect(await client.deleteProfile(PID)).toEqual({
      kind: 'conflict',
      reason: 'not-published',
    });
  });

  it('409 with another code → unavailable', async () => {
    const { client } = setup(() => json(409, { code: 'PROFILE_PUBLISHED' }));
    expect(await client.deleteProfile(PID)).toEqual({ kind: 'unavailable' });
  });

  it('503, network error, HTML body and empty 200 → unavailable', async () => {
    expect(await setup(() => json(503, {})).client.deleteProfile(PID)).toEqual({
      kind: 'unavailable',
    });
    expect(
      await setup(() => {
        throw new TypeError('fetch failed');
      }).client.deleteProfile(PID),
    ).toEqual({ kind: 'unavailable' });
    expect(
      await setup(
        () => new Response('<html></html>', { status: 502 }),
      ).client.deleteProfile(PID),
    ).toEqual({ kind: 'unavailable' });
    expect(
      await setup(() => new Response('', { status: 200 })).client.deleteProfile(
        PID,
      ),
    ).toEqual({ kind: 'unavailable' });
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
    expect(await client.deleteProfile(PID)).toEqual({ kind: 'unavailable' });
  });

  it('missing url or key → unavailable; no session → unauthorized; neither fetches', async () => {
    for (const overrides of [{ url: undefined }, { apiKey: undefined }]) {
      const { client, fetchMock } = setup(() => json(200, {}), overrides);
      expect(await client.deleteProfile(PID)).toEqual({ kind: 'unavailable' });
      expect(fetchMock).not.toHaveBeenCalled();
    }
    const { client, fetchMock } = setup(() => json(200, {}), {
      accessToken: async () => null,
    });
    expect(await client.deleteProfile(PID)).toEqual({ kind: 'unauthorized' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a non-UUID id → not-found without fetching, raw value not logged', async () => {
    const { client, fetchMock, log } = setup(() => json(200, {}));
    expect(await client.deleteProfile('../x?y=1')).toEqual({
      kind: 'not-found',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      'engine deleteProfile profile=invalid outcome=not-found status=none',
    );
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
});

describe('engine client search switches', () => {
  const views = [
    { key: 'posts', enabled: false, searches: 2 },
    { key: 'indeed', enabled: true, searches: 3 },
  ];

  it('searchSwitches returns the list', async () => {
    const { client, fetchMock } = setup(() =>
      json(200, { status: 'success', data: views }),
    );
    expect(await client.searchSwitches(PID)).toEqual({
      kind: 'ok',
      data: views,
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`http://engine.test/api/profiles/${PID}/searches`);
    expect(init?.method).toBe('GET');
    const headers = new Headers(init?.headers);
    expect(headers.get('x-engine-key')).toBe(KEY);
    expect(headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
  });

  it('searchSwitches maps a malformed list to unavailable', async () => {
    const { client } = setup(() =>
      json(200, {
        status: 'success',
        data: [{ key: 'posts', enabled: true }],
      }),
    );
    expect(await client.searchSwitches(PID)).toEqual({ kind: 'unavailable' });
  });

  it('setSearchSwitch PUTs to /searches/<key> with { enabled }', async () => {
    const { client, fetchMock } = setup(() =>
      json(200, { status: 'success', data: views[1] }),
    );
    expect(await client.setSearchSwitch(PID, 'indeed', true)).toEqual({
      kind: 'ok',
      data: views[1],
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`http://engine.test/api/profiles/${PID}/searches/indeed`);
    expect(init?.method).toBe('PUT');
    expect(init?.body).toBe('{"enabled":true}');
    expect(new Headers(init?.headers).get('content-type')).toBe(
      'application/json',
    );
  });

  it('maps 404 to not-found', async () => {
    const { client } = setup(() => json(404, {}));
    expect(await client.setSearchSwitch(PID, 'posts', true)).toEqual({
      kind: 'not-found',
    });
  });

  it('an invalid profile id is not-found without a request', async () => {
    const { client, fetchMock } = setup(() => json(200, {}));
    expect(await client.searchSwitches('nope')).toEqual({ kind: 'not-found' });
    expect(await client.setSearchSwitch('nope', 'indeed', true)).toEqual({
      kind: 'not-found',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('engine client admin review', () => {
  const author = {
    key: 'profile:jane',
    name: 'Jane',
    headline: 'CTO',
    profileUrl: 'https://www.linkedin.com/in/jane',
  };
  const drop = {
    rawItemId: 'r1',
    reason: 'prepare: hashtag-spam: "#hiring #hiring"',
    rule: 'hashtag-spam',
    match: '#hiring #hiring',
    postedAt: '2026-11-20T10:00:00.000Z',
    url: 'https://www.linkedin.com/posts/1',
    author,
  };
  const held = {
    jobId: 'j1',
    url: 'https://www.linkedin.com/posts/2',
    author,
    postedAt: null,
  };
  const silenced = {
    id: 's1',
    authorKey: 'profile:jane',
    name: 'Jane',
    reason: 'spam',
    origin: 'manual',
    evidence: null,
    createdBy: 'u1',
    createdAt: '2026-11-20T10:00:00.000Z',
  };
  const ok = (data: unknown, status = 200) =>
    json(status, { status: 'success', data });

  function expectAuth(init: RequestInit | undefined) {
    const headers = new Headers(init?.headers);
    expect(headers.get('x-engine-key')).toBe(KEY);
    expect(headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
  }

  it('adminMe sends GET /api/admin/me', async () => {
    const { client, fetchMock } = setup(() => ok({ admin: true }));
    expect(await client.adminMe()).toEqual({
      kind: 'ok',
      data: { admin: true },
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://engine.test/api/admin/me');
    expect(init?.method).toBe('GET');
    expectAuth(init);
  });

  it('adminMe with a bad body → unavailable', async () => {
    const { client } = setup(() => ok({ admin: 'yes' }));
    expect(await client.adminMe()).toEqual({ kind: 'unavailable' });
  });

  it('adminRescues sends GET /admin/rescues with the limit and checks the shape', async () => {
    const item = {
      id: 'r1',
      createdAt: '2026-11-27T10:00:00.000Z',
      undoneAt: null,
      origin: 'junk',
      note: null,
      snapshot: {},
      job: { id: 'j', kind: 'post', title: null, postingUrl: 'https://x.y' },
      user: { id: 'u' },
    };
    const { client, fetchMock } = setup(() => ok({ items: [item] }));
    expect(await client.adminRescues({ limit: 20 })).toEqual({
      kind: 'ok',
      data: { items: [item] },
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://engine.test/api/admin/rescues?limit=20');
    expect(init?.method).toBe('GET');
    expectAuth(init);
    const bad = setup(() => ok({ items: [{ id: 1 }] }));
    expect(await bad.client.adminRescues()).toEqual({ kind: 'unavailable' });
  });

  it('prepareDrops sends the rule, cursor and limit as query params', async () => {
    const { client, fetchMock } = setup(() =>
      ok({ items: [drop], next: 'abc' }),
    );
    expect(
      await client.prepareDrops({
        rule: 'hashtag spam',
        before: 'cur/sor=',
        limit: 20,
      }),
    ).toEqual({ kind: 'ok', data: { items: [drop], next: 'abc' } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'http://engine.test/api/admin/prepare/drops?rule=hashtag+spam&before=cur%2Fsor%3D&limit=20',
    );
    expect(init?.method).toBe('GET');
    expect(init?.body).toBeUndefined();
    expectAuth(init);
  });

  it('prepareDrops with no options sends no query', async () => {
    const { client, fetchMock } = setup(() => ok({ items: [], next: null }));
    expect(await client.prepareDrops()).toEqual({
      kind: 'ok',
      data: { items: [], next: null },
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://engine.test/api/admin/prepare/drops',
    );
  });

  it('prepareDrops with a malformed page → unavailable', async () => {
    const { client } = setup(() => ok({ items: [{ rawItemId: 1 }], next: 1 }));
    expect(await client.prepareDrops()).toEqual({ kind: 'unavailable' });
  });

  it('silencedPosts sends GET …/prepare/silenced-posts with the cursor', async () => {
    const { client, fetchMock } = setup(() =>
      ok({ items: [held], next: null }),
    );
    expect(await client.silencedPosts({ before: 'j0', limit: 5 })).toEqual({
      kind: 'ok',
      data: { items: [held], next: null },
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'http://engine.test/api/admin/prepare/silenced-posts?before=j0&limit=5',
    );
    expect(init?.method).toBe('GET');
    expectAuth(init);
  });

  it('extractVerdicts sends the verdict, reason, cursor and limit as query params', async () => {
    const verdict = {
      jobId: 'j1',
      verdict: 'junk',
      reason: 'funnel',
      quote: 'Join my group',
      confidence: 'sure',
      author,
      postedAt: null,
      url: 'https://www.linkedin.com/posts/1',
      extractedAt: '2026-11-22T09:00:00.000Z',
    };
    const { client, fetchMock } = setup(() =>
      ok({ items: [verdict], next: 'c2' }),
    );
    expect(
      await client.extractVerdicts({
        verdict: 'junk',
        reason: 'funnel',
        before: 'c1',
        limit: 5,
      }),
    ).toEqual({ kind: 'ok', data: { items: [verdict], next: 'c2' } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'http://engine.test/api/admin/extract/verdicts?verdict=junk&reason=funnel&before=c1&limit=5',
    );
    expect(init?.method).toBe('GET');
    expectAuth(init);
  });

  it('extractVerdicts with a malformed row → unavailable', async () => {
    const { client } = setup(() =>
      ok({ items: [{ jobId: 'j1', verdict: 'junk' }], next: null }),
    );
    expect(await client.extractVerdicts()).toEqual({ kind: 'unavailable' });
  });

  it('autoSilenceCandidates sends GET /api/admin/extract/auto-silence-candidates', async () => {
    const candidate = {
      authorKey: 'company:agg',
      name: null,
      counted: 12,
      firstSeenAt: '2026-11-01T08:00:00.000Z',
      lastSeenAt: '2026-11-09T08:00:00.000Z',
      verdicts: { junk: 10, not_hiring: 2 },
    };
    const { client, fetchMock } = setup(() => ok([candidate]));
    expect(await client.autoSilenceCandidates()).toEqual({
      kind: 'ok',
      data: [candidate],
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'http://engine.test/api/admin/extract/auto-silence-candidates',
    );
    expect(init?.method).toBe('GET');
    expectAuth(init);
  });

  it('autoSilenceCandidates with a malformed row → unavailable', async () => {
    const { client } = setup(() =>
      ok([{ authorKey: 'company:agg', counted: '12' }]),
    );
    expect(await client.autoSilenceCandidates()).toEqual({
      kind: 'unavailable',
    });
  });

  it('silencedAuthors sends GET /api/admin/silenced-authors', async () => {
    const { client, fetchMock } = setup(() => ok([silenced]));
    expect(await client.silencedAuthors()).toEqual({
      kind: 'ok',
      data: [silenced],
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://engine.test/api/admin/silenced-authors');
    expect(init?.method).toBe('GET');
    expectAuth(init);
  });

  it('silencedAuthors with a non-array → unavailable', async () => {
    const { client } = setup(() => ok({}));
    expect(await client.silencedAuthors()).toEqual({ kind: 'unavailable' });
  });

  it('silenceAuthor POSTs the key, name and reason; 201 → silenced', async () => {
    const { client, fetchMock } = setup(() => ok({ status: 'silenced' }, 201));
    expect(
      await client.silenceAuthor({
        authorKey: 'profile:jane',
        name: 'Jane',
        reason: 'spam',
      }),
    ).toEqual({ kind: 'ok', data: { status: 'silenced' } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://engine.test/api/admin/silenced-authors');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(
      '{"authorKey":"profile:jane","name":"Jane","reason":"spam"}',
    );
    expect(new Headers(init?.headers).get('content-type')).toBe(
      'application/json',
    );
    expectAuth(init);
  });

  it('silenceAuthor leaves a null name out; 200 → already', async () => {
    const { client, fetchMock } = setup(() => ok({ status: 'already' }));
    expect(
      await client.silenceAuthor({
        authorKey: 'company:acme',
        name: null,
        reason: 'spam',
      }),
    ).toEqual({ kind: 'ok', data: { status: 'already' } });
    expect(fetchMock.mock.calls[0][1]?.body).toBe(
      '{"authorKey":"company:acme","reason":"spam"}',
    );
  });

  it('unsilenceAuthor DELETEs the URL-encoded key; 204 → ok', async () => {
    const { client, fetchMock } = setup(
      () => new Response(null, { status: 204 }),
    );
    expect(await client.unsilenceAuthor('profile:jane doe/x')).toEqual({
      kind: 'ok',
      data: null,
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'http://engine.test/api/admin/silenced-authors/profile%3Ajane%20doe%2Fx',
    );
    expect(init?.method).toBe('DELETE');
    expect(init?.body).toBeUndefined();
    expectAuth(init);
  });

  it('unsilenceAuthor 404 → not-found', async () => {
    const { client } = setup(() => json(404, { code: 'NOT_FOUND' }));
    expect(await client.unsilenceAuthor('profile:jane')).toEqual({
      kind: 'not-found',
    });
  });

  const calls = [
    ['adminMe', (c: ReturnType<typeof setup>['client']) => c.adminMe()],
    [
      'prepareDrops',
      (c: ReturnType<typeof setup>['client']) => c.prepareDrops(),
    ],
    [
      'silencedPosts',
      (c: ReturnType<typeof setup>['client']) => c.silencedPosts(),
    ],
    [
      'extractVerdicts',
      (c: ReturnType<typeof setup>['client']) => c.extractVerdicts(),
    ],
    [
      'autoSilenceCandidates',
      (c: ReturnType<typeof setup>['client']) => c.autoSilenceCandidates(),
    ],
    [
      'silencedAuthors',
      (c: ReturnType<typeof setup>['client']) => c.silencedAuthors(),
    ],
    [
      'silenceAuthor',
      (c: ReturnType<typeof setup>['client']) =>
        c.silenceAuthor({ authorKey: 'profile:a', reason: 'r' }),
    ],
    [
      'unsilenceAuthor',
      (c: ReturnType<typeof setup>['client']) => c.unsilenceAuthor('profile:a'),
    ],
  ] as const;

  it.each(calls)('%s maps error statuses to result kinds', async (_, call) => {
    const cases: [Response, unknown][] = [
      [json(401, { code: 'UNAUTHORIZED' }), { kind: 'unauthorized' }],
      [json(403, { code: 'FORBIDDEN' }), { kind: 'forbidden' }],
      [json(404, { code: 'NOT_FOUND' }), { kind: 'not-found' }],
      [
        json(400, { code: 'BAD_REQUEST', message: 'limit must not be > 200' }),
        { kind: 'invalid', message: 'limit must not be > 200' },
      ],
      [
        json(400, { code: 'VALIDATION_FAILED' }),
        { kind: 'invalid', message: 'Bad request' },
      ],
      [json(503, { code: 'SERVICE_UNAVAILABLE' }), { kind: 'unavailable' }],
      [
        new Response('<html>Bad Gateway</html>', { status: 502 }),
        { kind: 'unavailable' },
      ],
    ];
    for (const [response, expected] of cases) {
      const { client } = setup(() => response);
      expect(await call(client)).toEqual(expected);
    }
  });

  it.each(calls)(
    '%s: network error → unavailable; no session → unauthorized; no config → unavailable',
    async (_, call) => {
      const failing = setup(() => {
        throw new TypeError('fetch failed');
      });
      expect(await call(failing.client)).toEqual({ kind: 'unavailable' });

      const noSession = setup(() => json(200, {}), {
        accessToken: async () => null,
      });
      expect(await call(noSession.client)).toEqual({ kind: 'unauthorized' });
      expect(noSession.fetchMock).not.toHaveBeenCalled();

      const noUrl = setup(() => json(200, {}), { url: undefined });
      expect(await call(noUrl.client)).toEqual({ kind: 'unavailable' });
      expect(noUrl.fetchMock).not.toHaveBeenCalled();
    },
  );

  it('logs the call, outcome and status, never the key, token or author key', async () => {
    const { client, log } = setup(() => json(403, { code: 'FORBIDDEN' }));
    await client.unsilenceAuthor('profile:secret-person');
    expect(log).toHaveBeenCalledWith(
      'engine unsilenceAuthor outcome=forbidden status=403',
    );
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).not.toContain(KEY);
    expect(logged).not.toContain(TOKEN);
    expect(logged).not.toContain('secret-person');
  });
});

describe('engine client searches', () => {
  it('searchesState maps 200', async () => {
    const view = { paused: true, lastActiveAt: '2026-11-20T10:00:00.000Z' };
    const { client, fetchMock } = setup(() =>
      json(200, { status: 'success', data: view }),
    );
    expect(await client.searchesState()).toEqual({ kind: 'ok', data: view });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://engine.test/api/me/searches');
    expect(init?.method).toBe('GET');
    const headers = new Headers(init?.headers);
    expect(headers.get('x-engine-key')).toBe(KEY);
    expect(headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
  });

  it('resumeSearches posts and maps 200', async () => {
    const view = { paused: false, lastActiveAt: null };
    const { client, fetchMock } = setup(() =>
      json(200, { status: 'success', data: view }),
    );
    expect(await client.resumeSearches()).toEqual({ kind: 'ok', data: view });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://engine.test/api/me/searches/resume');
    expect(init?.method).toBe('POST');
  });

  it('resumeSearches maps 503 to an error result', async () => {
    const { client } = setup(() => json(503, { code: 'SERVICE_UNAVAILABLE' }));
    expect(await client.resumeSearches()).toEqual({ kind: 'unavailable' });
  });

  it('searchesState rejects a malformed body', async () => {
    const { client } = setup(() =>
      json(200, { status: 'success', data: { paused: 'yes' } }),
    );
    expect(await client.searchesState()).toEqual({ kind: 'unavailable' });
  });
});

describe('engine client forwardWebhookCallback', () => {
  const headers = {
    'x-10xjobs-webhook': 'wh-1',
    'x-10xjobs-timestamp': '1800000000',
    'x-10xjobs-signature': 'sha256=abc',
  };
  const body = new TextEncoder().encode('{ "a" :  "é" }\n');

  it('sends the engine key, the three headers and a JSON content type', async () => {
    const { client, fetchMock } = setup(() => json(200, { version: 1 }));
    await client.forwardWebhookCallback({ body, headers });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://engine.test/api/webhooks/callback');
    expect(init?.method).toBe('POST');
    const sent = new Headers(init?.headers);
    expect(sent.get('x-engine-key')).toBe(KEY);
    expect(sent.get('x-10xjobs-webhook')).toBe('wh-1');
    expect(sent.get('x-10xjobs-timestamp')).toBe('1800000000');
    expect(sent.get('x-10xjobs-signature')).toBe('sha256=abc');
    expect(sent.get('content-type')).toBe('application/json');
  });

  it('never sends Authorization, and omits a missing header', async () => {
    const { client, fetchMock } = setup(() => json(200, {}));
    await client.forwardWebhookCallback({
      body,
      headers: { ...headers, 'x-10xjobs-signature': null },
    });
    const sent = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(sent.has('authorization')).toBe(false);
    expect(sent.has('x-10xjobs-signature')).toBe(false);
  });

  it('passes the body bytes unchanged', async () => {
    const { client, fetchMock } = setup(() => json(200, {}));
    await client.forwardWebhookCallback({ body, headers });
    expect(fetchMock.mock.calls[0][1]?.body).toBe(body);
  });

  it('returns the engine status and text, even for an error', async () => {
    const { client } = setup(() => json(401, { code: 'UNAUTHORIZED' }));
    expect(await client.forwardWebhookCallback({ body, headers })).toEqual({
      status: 401,
      body: '{"code":"UNAUTHORIZED"}',
    });
  });

  it('is unavailable without a url or key, or when fetch throws', async () => {
    for (const overrides of [
      { url: undefined },
      { apiKey: undefined },
    ] as Partial<EngineClientDeps>[]) {
      const { client, fetchMock } = setup(() => json(200, {}), overrides);
      expect(await client.forwardWebhookCallback({ body, headers })).toEqual({
        kind: 'unavailable',
      });
      expect(fetchMock).not.toHaveBeenCalled();
    }
    const { client } = setup(() => {
      throw new Error('down');
    });
    expect(await client.forwardWebhookCallback({ body, headers })).toEqual({
      kind: 'unavailable',
    });
  });

  it('logs the status only', async () => {
    const { client, log } = setup(() => json(200, { secret: 'zzz' }));
    await client.forwardWebhookCallback({ body, headers });
    const lines = log.mock.calls.map((c) => String(c[0])).join('\n');
    expect(lines).toContain('status=200');
    expect(lines).not.toMatch(/zzz|sha256|wh-1/);
  });
});
