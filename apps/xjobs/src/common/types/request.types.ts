import type { Request } from 'express';

/** A request after `traceIdMiddleware` has tagged it. */
export type TracedRequest = Request & { traceId?: string };

/** A request after `UserGuard` has verified the user token. */
export type AuthedRequest = TracedRequest & { userId?: string };
