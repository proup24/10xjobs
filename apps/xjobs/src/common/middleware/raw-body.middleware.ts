import express, { type RequestHandler } from 'express';

/** Where `app.use` mounts `callbackRawBody`, under the global prefix. */
export function callbackPath(prefix: string): string {
  return `/${prefix}/webhooks/callback`;
}

/**
 * Reads the callback body as raw bytes, whatever its Content-Type, so a signed body that
 * is not JSON reaches the handler instead of failing in the JSON parser. Mount it with
 * `app.use(callbackPath(prefix), callbackRawBody)` before Nest's parsers (registered at
 * init); body-parser skips a request whose body is already read. The bytes are `req.body`.
 */
export const callbackRawBody: RequestHandler = express.raw({
  type: () => true,
  limit: '16kb',
});
