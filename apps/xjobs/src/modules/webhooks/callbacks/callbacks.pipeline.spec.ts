import type { ExecutionContext, INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { HttpExceptionFilter } from 'src/common/filters';
import { ResponseInterceptor } from 'src/common/interceptors';
import {
  engineKeyMiddleware,
  traceIdMiddleware,
  callbackPath,
  callbackRawBody,
} from 'src/common/middleware';
import { SearchesController } from 'src/modules/activity/searches.controller';
import { ActivityRepository } from 'src/modules/activity/activity.repository';
import { ConfigService } from '@nestjs/config';
import { UserGuard } from 'src/common/guards';
import { signature } from '../sender/sign';
import { CallbacksController } from './callbacks.controller';
import { CallbacksRepository } from './callbacks.repository';
import { MemoryCallbacksRepository } from './testing/memory-callbacks.repository';
import { CallbackThrottle } from './throttle';

const KEY = 'engine-key';
const SECRET = 's3cret';

describe('callback route through the middleware stack', () => {
  let app: INestApplication;
  let base: string;
  let repo: MemoryCallbacksRepository;

  beforeEach(async () => {
    repo = new MemoryCallbacksRepository();
    repo.addWebhook({ id: 'w1', userId: 'u1', secret: SECRET });
    const moduleRef = await Test.createTestingModule({
      controllers: [CallbacksController, SearchesController],
      providers: [
        { provide: CallbacksRepository, useValue: repo },
        { provide: CallbackThrottle, useValue: new CallbackThrottle(60) },
        {
          provide: ActivityRepository,
          useValue: {
            userState: async () => ({ paused: false, lastActiveAt: null }),
          },
        },
        {
          provide: ConfigService,
          useValue: { get: () => 24 },
        },
        { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
        { provide: APP_FILTER, useClass: HttpExceptionFilter },
      ],
    })
      .overrideGuard(UserGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          context.switchToHttp().getRequest().userId = 'u1';
          return true;
        },
      })
      .compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    // The same order as configure() in main.ts.
    app.use(traceIdMiddleware);
    app.use(engineKeyMiddleware(KEY));
    app.use(callbackPath('api'), callbackRawBody);
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  });
  afterEach(async () => {
    await app.close();
  });

  function send(body: string, headers: Record<string, string> = {}) {
    const ts = Math.floor(Date.now() / 1000);
    return fetch(`${base}/api/webhooks/callback`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-engine-key': KEY,
        'x-10xjobs-webhook': 'w1',
        'x-10xjobs-timestamp': String(ts),
        'x-10xjobs-signature': signature(SECRET, ts, Buffer.from(body)),
        ...headers,
      },
      body,
    });
  }

  it('a signed application/json body that is not JSON gets 200 invalid, logged', async () => {
    const res = await send('not json');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ version: 1, result: 'invalid' });
    expect(repo.callbacks).toHaveLength(1);
  });

  it('a signed valid ping as application/json gets 200 ok', async () => {
    const res = await send(JSON.stringify({ version: 1, type: 'ping' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: 1, result: 'ok' });
  });

  it('a request without the engine key gets 401 from the middleware', async () => {
    const res = await send('{}', { 'x-engine-key': 'wrong' });
    expect(res.status).toBe(401);
    expect(repo.callbacks).toHaveLength(0);
  });

  it('other routes still run behind the same stack', async () => {
    const res = await fetch(`${base}/api/me/searches`, {
      headers: { 'x-engine-key': KEY },
    });
    expect(res.status).toBe(200);
  });
});
