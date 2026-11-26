import { callbackEngineClient } from '@/lib/engine/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 16_384;

const JSON_HEADERS = { 'content-type': 'application/json' };

function reply(status: number, body: string) {
  return new Response(body, { status, headers: JSON_HEADERS });
}

/**
 * A pass-through for a receiver's signed callback: the raw bytes go to the
 * engine unchanged (the signature covers them), which answers. No session, and
 * the webhook secret is never read here. Nothing about the request is logged.
 */
export async function POST(request: Request): Promise<Response> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES)
    return reply(413, '{"version":1,"error":"too_large"}');

  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength > MAX_BODY_BYTES)
    return reply(413, '{"version":1,"error":"too_large"}');

  const result = await callbackEngineClient().forwardWebhookCallback({
    body,
    headers: {
      'x-10xjobs-webhook': request.headers.get('x-10xjobs-webhook'),
      'x-10xjobs-timestamp': request.headers.get('x-10xjobs-timestamp'),
      'x-10xjobs-signature': request.headers.get('x-10xjobs-signature'),
    },
    contentType: request.headers.get('content-type'),
  });
  if ('kind' in result)
    return reply(503, '{"version":1,"error":"unavailable"}');
  return reply(result.status, result.body);
}
