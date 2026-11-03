'use server';

import { redirect } from 'next/navigation';
import { requestCode, type RequestCodeResult } from '@/lib/auth/request-code';
import { verifyCode, type VerifyCodeResult } from '@/lib/auth/verify-code';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function requestCodeAction(
  email: string,
): Promise<RequestCodeResult> {
  const supabase = await createSupabaseServerClient();
  return requestCode(supabase.auth, email);
}

export async function verifyCodeAction(
  email: string,
  code: string,
): Promise<VerifyCodeResult> {
  const supabase = await createSupabaseServerClient();
  const result = await verifyCode(supabase.auth, email, code);
  if (result.ok) redirect('/');
  return result;
}
