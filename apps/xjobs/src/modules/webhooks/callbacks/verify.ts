import { timingSafeEqual } from 'node:crypto';
import { signature } from '../sender/sign';

/**
 * Checks a callback's signature over `${timestamp}.${rawBody}` and that the timestamp
 * is within `toleranceSeconds` either way. Never throws.
 */
export function verifyCallback(input: {
  secret: string;
  timestamp: string | undefined;
  received: string | undefined;
  rawBody: Buffer;
  nowSeconds: number;
  toleranceSeconds?: number;
}): boolean {
  const { timestamp, received } = input;
  if (!timestamp || !received || !/^\d{1,15}$/.test(timestamp)) return false;
  const seconds = Number(timestamp);
  if (Math.abs(input.nowSeconds - seconds) > (input.toleranceSeconds ?? 300))
    return false;
  const expected = Buffer.from(signature(input.secret, seconds, input.rawBody));
  const actual = Buffer.from(received);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
