import { createHmac } from 'node:crypto';

export function signature(
  secret: string,
  timestamp: number,
  body: Buffer,
): string {
  const hmac = createHmac('sha256', secret);
  hmac.update(`${timestamp}.`);
  hmac.update(body);
  return `v1=${hmac.digest('hex')}`;
}
