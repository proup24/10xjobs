import type { INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { HttpExceptionFilter } from 'src/common/filters';
import { ResponseInterceptor } from 'src/common/interceptors';
import { signature } from '../sender/sign';
import { CallbacksController } from './callbacks.controller';
import { CallbacksRepository } from './callbacks.repository';
import { MemoryCallbacksRepository } from './testing/memory-callbacks.repository';
import { CallbackThrottle } from './throttle';

const SECRET = 's3cret';
const WEBHOOK = { id: 'w1', userId: 'u1', secret: SECRET };
const JOB = '3f2b8a52-6c1d-4d0e-9a57-0b1e3f4c5d6e';

describe('POST /api/webhooks/callback', () => {
  let app: INestApplication;
  let url: string;
  let repo: MemoryCallbacksRepository;
  let perMinute = 60;

  async function start() {
    repo = new MemoryCallbacksRepository();
    repo.addWebhook(WEBHOOK);
    const moduleRef = await Test.createTestingModule({
      controllers: [CallbacksController],
      providers: [
        { provide: CallbacksRepository, useValue: repo },
        {
          provide: CallbackThrottle,
          useValue: new CallbackThrottle(perMinute),
        },
        { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
        { provide: APP_FILTER, useClass: HttpExceptionFilter },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
    url = `${await app.getUrl()}/api/webhooks/callback`;
  }

  beforeEach(async () => {
    perMinute = 60;
  });
  afterEach(async () => {
    await app?.close();
  });

  function send(
    body: string,
    over: {
      type?: string;
      webhook?: string;
      secret?: string;
      ts?: number;
      sig?: string;
    } = {},
  ) {
    const ts = over.ts ?? Math.floor(Date.now() / 1000);
    return fetch(url, {
      method: 'POST',
      headers: {
        'content-type': over.type ?? 'application/json',
        'x-10xjobs-webhook': over.webhook ?? 'w1',
        'x-10xjobs-timestamp': String(ts),
        'x-10xjobs-signature':
          over.sig ?? signature(over.secret ?? SECRET, ts, Buffer.from(body)),
      },
      body,
    });
  }
  const ping = JSON.stringify({ version: 1, type: 'ping' });

  it('ping gives {version:1,result:ok} with no envelope', async () => {
    await start();
    const res = await send(ping);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: 1, result: 'ok' });
    expect(repo.callbacks).toHaveLength(1);
  });

  it('an unknown webhook header gives 401', async () => {
    await start();
    expect((await send(ping, { webhook: 'nope' })).status).toBe(401);
    expect(repo.callbacks).toHaveLength(0);
  });

  it('a bad signature gives 401 and is not logged', async () => {
    await start();
    const res = await send(ping, { secret: 'wrong' });
    expect(res.status).toBe(401);
    expect(repo.callbacks).toHaveLength(0);
  });

  it('a replay gives 401', async () => {
    await start();
    const ts = Math.floor(Date.now() / 1000);
    expect((await send(ping, { ts })).status).toBe(200);
    expect((await send(ping, { ts })).status).toBe(401);
    expect(repo.callbacks).toHaveLength(1);
  });

  it('a throttled request gives 429 and is not logged', async () => {
    perMinute = 1;
    await start();
    const ts = Math.floor(Date.now() / 1000);
    expect((await send(ping, { ts })).status).toBe(200);
    expect((await send(ping, { ts: ts + 1 })).status).toBe(429);
    expect(repo.callbacks).toHaveLength(1);
  });

  it('an invalid body still counts as activity', async () => {
    await start();
    const res = await send('not json', {
      type: 'application/x-www-form-urlencoded',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ version: 1, result: 'invalid' });
    expect(repo.callbacks).toHaveLength(1);
    expect(repo.callbacks[0].type).toBe('invalid');
  });

  it('saves feedback on a matched job', async () => {
    await start();
    repo.addMatch('u1', JOB);
    const res = await send(
      JSON.stringify({
        version: 1,
        type: 'feedback',
        jobId: JOB,
        status: 'applied',
      }),
    );
    expect(await res.json()).toEqual({
      version: 1,
      result: 'saved',
      jobId: JOB,
    });
  });
});
