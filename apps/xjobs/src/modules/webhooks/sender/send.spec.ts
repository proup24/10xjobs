import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type dns from 'node:dns';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Test seam: the local server listens on 127.0.0.1, which the real block list
// refuses. The real resolvePublic still runs (so deps.lookup and the block
// check are exercised); only a sentinel public address is rewritten to
// loopback so the pinned connect lands on the test server.
const SENTINEL = '93.184.216.34';
vi.mock('./address', async (orig) => {
  const actual = await orig<typeof import('./address')>();
  return {
    ...actual,
    resolvePublic: async (...args: Parameters<typeof actual.resolvePublic>) => {
      const r = await actual.resolvePublic(...args);
      return r.address === SENTINEL ? { ...r, address: '127.0.0.1' } : r;
    },
  };
});

import { send } from './send';

const HOST = 'hooks.example.test';
const lookupTo = (
  address: string,
  counter?: { n: number },
): typeof dns.lookup =>
  ((_h: string, _o: unknown, cb: (...a: unknown[]) => void) => {
    if (counter) counter.n++;
    cb(null, [{ address, family: 4 }]);
  }) as never;

let dir: string;
let cert: string;
let key: string;
let server: https.Server;
let port: number;
let seen: { headers: Record<string, unknown>; body: string }[] = [];
let handler: (
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
) => void;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'wh-cert-'));
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '2',
      '-keyout',
      join(dir, 'k.pem'),
      '-out',
      join(dir, 'c.pem'),
      '-subj',
      `/CN=${HOST}`,
      '-addext',
      `subjectAltName=DNS:${HOST}`,
    ],
    { stdio: 'ignore' },
  );
  cert = readFileSync(join(dir, 'c.pem'), 'utf8');
  key = readFileSync(join(dir, 'k.pem'), 'utf8');
  server = https.createServer({ cert, key }, (req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      seen.push({
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      handler(req, res);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  rmSync(dir, { recursive: true, force: true });
});

const input = (body = '{"x":"🚀 Zürich"}') => ({
  url: `https://${HOST}:${port}/hook`,
  body,
  secret: 'shh',
  deliveryId: 'del-1',
  event: 'match.qualified' as const,
  now: new Date('2026-11-16T10:00:00Z'),
});

describe('send', () => {
  it('a 200 is ok and sends all four headers with a valid signature', async () => {
    seen = [];
    handler = (_q, res) => res.writeHead(200).end('ok');
    const i = input();
    const r = await send(i, { lookup: lookupTo(SENTINEL), ca: cert });
    expect(r).toEqual({ ok: true, status: 200 });
    const { headers, body } = seen[0];
    const ts = Math.floor(i.now.getTime() / 1000);
    expect(body).toBe(i.body);
    expect(headers['x-10xjobs-delivery']).toBe('del-1');
    expect(headers['x-10xjobs-event']).toBe('match.qualified');
    expect(headers['x-10xjobs-timestamp']).toBe(String(ts));
    expect(headers['x-10xjobs-signature']).toBe(
      `v1=${createHmac('sha256', 'shh').update(`${ts}.${i.body}`).digest('hex')}`,
    );
    expect(headers['content-type']).toBe('application/json');
    expect(headers['user-agent']).toBe('10xjobs-webhooks/1');
    expect(headers.host).toBe(`${HOST}:${port}`);
  });

  it('a 503 is http 503', async () => {
    handler = (_q, res) => res.writeHead(503).end();
    expect(
      await send(input(), { lookup: lookupTo(SENTINEL), ca: cert }),
    ).toEqual({
      ok: false,
      status: 503,
      error: 'http 503',
    });
  });

  it('a 302 is not followed', async () => {
    seen = [];
    handler = (_q, res) => res.writeHead(302, { Location: '/elsewhere' }).end();
    expect(
      await send(input(), { lookup: lookupTo(SENTINEL), ca: cert }),
    ).toEqual({
      ok: false,
      status: 302,
      error: 'http 302',
    });
    expect(seen).toHaveLength(1);
  });

  it('a server that never answers times out at timeoutMs', async () => {
    handler = () => undefined;
    const started = Date.now();
    const r = await send(input(), {
      lookup: lookupTo(SENTINEL),
      ca: cert,
      timeoutMs: 200,
    });
    expect(r).toEqual({ ok: false, status: null, error: 'timeout' });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('a server trickling bytes cannot outlive the wall-clock timeout', async () => {
    handler = (_q, res) => {
      res.writeHead(200);
      const t = setInterval(() => res.write('x'), 50);
      res.on('close', () => clearInterval(t));
    };
    const started = Date.now();
    const r = await send(input(), {
      lookup: lookupTo(SENTINEL),
      ca: cert,
      timeoutMs: 200,
    });
    expect(r).toEqual({ ok: false, status: null, error: 'timeout' });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('a lookup that never resolves times out', async () => {
    const hang = (() => undefined) as unknown as typeof dns.lookup;
    const r = await send(input(), { lookup: hang, ca: cert, timeoutMs: 200 });
    expect(r).toEqual({ ok: false, status: null, error: 'timeout' });
  });

  it('a huge response body does not break a 200', async () => {
    handler = (_q, res) => res.writeHead(200).end('x'.repeat(100_000));
    expect(
      await send(input(), { lookup: lookupTo(SENTINEL), ca: cert }),
    ).toEqual({
      ok: true,
      status: 200,
    });
  });

  it('connects to the pinned IP even if a second lookup would differ', async () => {
    handler = (_q, res) => res.writeHead(200).end();
    const counter = { n: 0 };
    const r = await send(input(), {
      lookup: lookupTo(SENTINEL, counter),
      ca: cert,
    });
    expect(r.ok).toBe(true);
    expect(counter.n).toBe(1);
  });

  it('refuses a private address without connecting', async () => {
    seen = [];
    expect(
      await send(input(), { lookup: lookupTo('10.0.0.5'), ca: cert }),
    ).toEqual({
      ok: false,
      status: null,
      error: 'blocked address',
    });
    expect(seen).toHaveLength(0);
  });

  it('reports the error code for an untrusted certificate', async () => {
    handler = (_q, res) => res.writeHead(200).end();
    const r = await send(input(), { lookup: lookupTo(SENTINEL) });
    expect(r.ok).toBe(false);
    expect((r as { status: unknown }).status).toBeNull();
    expect((r as { error: string }).error).toMatch(/CERT|SELF_SIGNED/);
  });
});
