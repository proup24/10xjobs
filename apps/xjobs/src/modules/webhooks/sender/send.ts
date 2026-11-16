import type dns from 'node:dns';
import https from 'node:https';
import { BlockedAddressError, resolvePublic } from './address';
import { signature } from './sign';
import { WEBHOOK_CONFIG } from '../config/webhooks.config';

export type SendResult =
  | { ok: true; status: number }
  | { ok: false; status: number | null; error: string };

export interface SendInput {
  url: string;
  body: string;
  secret: string;
  deliveryId: string;
  event: 'match.qualified' | 'test';
  now: Date;
}

export interface SendDeps {
  lookup?: typeof dns.lookup;
  ca?: string | Buffer;
  timeoutMs?: number;
}

const fail = (status: number | null, error: string): SendResult => ({
  ok: false,
  status,
  error: error.slice(0, WEBHOOK_CONFIG.maxErrorChars),
});

export async function send(
  input: SendInput,
  deps: SendDeps = {},
): Promise<SendResult> {
  try {
    const url = new URL(input.url);
    if (url.protocol !== 'https:') return fail(null, 'invalid url');
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const pinned = await resolvePublic(hostname, deps.lookup);
    const body = Buffer.from(input.body, 'utf8');
    const timestamp = Math.floor(input.now.getTime() / 1000);
    const timeoutMs = deps.timeoutMs ?? WEBHOOK_CONFIG.timeoutMs;

    return await new Promise<SendResult>((resolve) => {
      let settled = false;
      const done = (r: SendResult) => {
        if (settled) return;
        settled = true;
        resolve(r);
      };
      const req = https.request(
        {
          protocol: 'https:',
          hostname,
          port: url.port || 443,
          path: `${url.pathname}${url.search}`,
          method: 'POST',
          servername: hostname,
          ca: deps.ca,
          agent: false,
          // Pinned: connect to the address already checked, never resolve again.
          lookup: ((_host, options, cb) => {
            if (typeof options === 'object' && options?.all) {
              cb(null, [pinned] as never, undefined as never);
            } else {
              (cb as (...a: unknown[]) => void)(
                null,
                pinned.address,
                pinned.family,
              );
            }
          }) as typeof dns.lookup,
          headers: {
            Host: url.host,
            'Content-Type': 'application/json',
            'Content-Length': body.length,
            'User-Agent': '10xjobs-webhooks/1',
            'X-10xjobs-Delivery': input.deliveryId,
            'X-10xjobs-Event': input.event,
            'X-10xjobs-Timestamp': String(timestamp),
            'X-10xjobs-Signature': signature(input.secret, timestamp, body),
          },
        },
        (res) => {
          const status = res.statusCode ?? 0;
          let read = 0;
          res.on('data', (chunk: Buffer) => {
            read += chunk.length;
            if (read >= WEBHOOK_CONFIG.maxResponseBytes) res.destroy();
          });
          const finish = () =>
            done(
              status >= 200 && status < 300
                ? { ok: true, status }
                : fail(status, `http ${status}`),
            );
          res.on('end', finish);
          res.on('close', finish);
          res.on('error', finish);
        },
      );
      req.setTimeout(timeoutMs, () => {
        done(fail(null, 'timeout'));
        req.destroy();
      });
      req.on('error', (err: NodeJS.ErrnoException) =>
        done(fail(null, err.code ?? err.name ?? 'error')),
      );
      req.end(body);
    });
  } catch (err) {
    if (err instanceof BlockedAddressError)
      return fail(null, 'blocked address');
    const e = err as NodeJS.ErrnoException;
    return fail(null, e?.code ?? e?.name ?? 'error');
  }
}
