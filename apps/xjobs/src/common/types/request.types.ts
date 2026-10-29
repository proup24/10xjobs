import type { Request } from 'express';

/** A request after `traceIdMiddleware` has tagged it. */
export type TracedRequest = Request & { traceId?: string };
