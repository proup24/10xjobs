import {
  StreamableFile,
  type CallHandler,
  type ExecutionContext,
} from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { API_VERSION } from '../constants';
import { ResponseStatus } from '../enums';
import { ResponseInterceptor } from './response.interceptor';

function contextFor(request: object): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

const handler = (value: unknown): CallHandler => ({ handle: () => of(value) });

describe('ResponseInterceptor', () => {
  const interceptor = new ResponseInterceptor();

  it('wraps a body in the success envelope', async () => {
    const body = await lastValueFrom(
      interceptor.intercept(
        contextFor({ traceId: 'trace-1' }),
        handler({ id: 1 }),
      ),
    );
    expect(body).toEqual({
      status: ResponseStatus.success,
      version: API_VERSION,
      timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      trace_id: 'trace-1',
      data: { id: 1 },
    });
  });

  it('wraps a list as data', async () => {
    const body = await lastValueFrom(
      interceptor.intercept(contextFor({ traceId: 't' }), handler([1, 2])),
    );
    expect(body).toMatchObject({ data: [1, 2] });
  });

  it('leaves a file stream untouched', async () => {
    const file = new StreamableFile(Buffer.from('%PDF-'));
    const body = await lastValueFrom(
      interceptor.intercept(contextFor({ traceId: 't' }), handler(file)),
    );
    expect(body).toBe(file);
  });

  it('leaves an empty (204) body empty', async () => {
    const body = await lastValueFrom(
      interceptor.intercept(contextFor({ traceId: 't' }), handler(undefined)),
    );
    expect(body).toBeUndefined();
  });
});
