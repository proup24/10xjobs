import { LINK_FAILED, SESSION_EXPIRED } from './copy';

const REASONS: Record<string, string> = {
  expired: SESSION_EXPIRED,
  link: LINK_FAILED,
};

/** Banner copy for a `?reason=` value; own keys only, so `__proto__` is no reason. */
export function reasonMessage(
  reason: string | string[] | undefined,
): string | undefined {
  if (typeof reason !== 'string' || !Object.hasOwn(REASONS, reason)) {
    return undefined;
  }
  return REASONS[reason];
}
