import type { SupabaseClient } from '@supabase/supabase-js';
import { NEUTRAL_SENT } from './copy';

export const MIN_RESPONSE_MS = 1500;

const INVALID_EMAIL = 'Enter a valid email address.';
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type RequestCodeResult =
  | { status: 'sent'; message: typeof NEUTRAL_SENT }
  | { status: 'invalid'; message: typeof INVALID_EMAIL };

type Deps = {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (outcome: string) => void;
};

export async function requestCode(
  auth: Pick<SupabaseClient['auth'], 'signInWithOtp'>,
  rawEmail: string,
  deps: Deps = {},
): Promise<RequestCodeResult> {
  const now = deps.now ?? Date.now;
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log =
    deps.log ??
    ((outcome: string) => console.info('sign-in code request:', outcome));

  const email = rawEmail.trim().toLowerCase();
  if (!EMAIL_SHAPE.test(email))
    return { status: 'invalid', message: INVALID_EMAIL };

  const start = now();
  try {
    const { error } = await auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });
    log(error?.code ?? 'sent');
  } catch {
    log('request_failed');
  }
  const remaining = MIN_RESPONSE_MS - (now() - start);
  if (remaining > 0) await sleep(remaining);
  return { status: 'sent', message: NEUTRAL_SENT };
}
