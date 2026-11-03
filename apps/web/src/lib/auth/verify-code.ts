import type { SupabaseClient } from '@supabase/supabase-js';
import { CODE_FAILED } from './copy';

export type VerifyCodeResult =
  | { ok: true }
  | { ok: false; message: typeof CODE_FAILED };

export async function verifyCode(
  auth: Pick<SupabaseClient['auth'], 'verifyOtp'>,
  rawEmail: string,
  code: string,
): Promise<VerifyCodeResult> {
  if (!/^\d{6}$/.test(code)) return { ok: false, message: CODE_FAILED };
  try {
    const { error } = await auth.verifyOtp({
      email: rawEmail.trim().toLowerCase(),
      token: code,
      type: 'email',
    });
    if (error) return { ok: false, message: CODE_FAILED };
  } catch {
    return { ok: false, message: CODE_FAILED };
  }
  return { ok: true };
}
