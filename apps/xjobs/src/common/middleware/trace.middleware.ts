import { randomUUID } from 'node:crypto';
import type { NextFunction, Response } from 'express';
import type { TracedRequest } from '../types';

/** Header names a caller or proxy may already use for a request id. */
const INCOMING = ['x-request-id', 'x-trace-id'];
/** Anything else could smuggle header syntax back out in X-Trace-Id. */
const SAFE_ID = /^[\w.-]{1,128}$/;

/**
 * @description Gives every request a trace id: the caller's own when it is
 * well-formed, a new UUID otherwise. Envelopes report it as `trace_id`.
 */
export function traceIdMiddleware(
  request: TracedRequest,
  response: Response,
  next: NextFunction,
): void {
  const incoming = INCOMING.map((name) => request.headers[name]).find(
    (value): value is string =>
      typeof value === 'string' && SAFE_ID.test(value),
  );
  request.traceId = incoming ?? randomUUID();
  response.setHeader('X-Trace-Id', request.traceId);
  next();
}

/** The request's trace id, minting one if the middleware did not run. */
export function traceIdOf(request: TracedRequest): string {
  request.traceId ??= randomUUID();
  return request.traceId;
}
