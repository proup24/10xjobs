'use server';

import { errorCode } from '@/lib/resume/errors';
import { FAILED, SAVED, type SaveResult } from '@/lib/setup/save-result';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { urlProblem } from './url';

type Client = Awaited<ReturnType<typeof createSupabaseServerClient>>;
type RpcError = { code?: unknown; message?: unknown } | null;

/**
 * The webhook RPCs, as the signed-in user. Each RPC acts on auth.uid() alone, so nothing
 * from the client names a user or a webhook. Log lines carry the RPC and the error code,
 * never the URL, the secret or the database message.
 */
async function run(
  call: (supabase: Client) => PromiseLike<{ error: RpcError }>,
  what: string,
  refusal: (e: NonNullable<RpcError>) => SaveResult | null = () => null,
): Promise<SaveResult> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims.sub) return FAILED;
  const { error } = await call(supabase);
  if (!error) return SAVED;
  const mapped = refusal(error);
  if (mapped) return mapped;
  console.error(`webhook: ${what} code=${errorCode(error)}`);
  return FAILED;
}

const formError = (message: string): SaveResult => ({
  status: 'invalid',
  errors: { _form: message },
});

export async function saveWebhookUrl(url: string): Promise<SaveResult> {
  if (typeof url !== 'string') {
    return { status: 'invalid', errors: { url: 'Enter a URL.' } };
  }
  const value = url.trim();
  return run(
    (s) => s.rpc('webhook_save', { p_url: value }),
    'webhook_save',
    (e) =>
      e.code === '22023'
        ? {
            status: 'invalid',
            errors: {
              url: urlProblem(value) ?? "This URL can't be used for a webhook.",
            },
          }
        : null,
  );
}

export async function setWebhookEnabled(on: boolean): Promise<SaveResult> {
  if (typeof on !== 'boolean') return FAILED;
  return run(
    (s) => s.rpc('webhook_set_enabled', { p_enabled: on }),
    'webhook_set_enabled',
  );
}

export async function rotateWebhookSecret(): Promise<SaveResult> {
  return run((s) => s.rpc('webhook_rotate_secret'), 'webhook_rotate_secret');
}

export async function deleteWebhook(): Promise<SaveResult> {
  return run((s) => s.rpc('webhook_delete'), 'webhook_delete');
}

export async function sendWebhookTest(): Promise<SaveResult> {
  return run(
    (s) => s.rpc('webhook_send_test'),
    'webhook_send_test',
    (e) => {
      if (e.code !== 'P0001') return null;
      if (e.message === 'too soon') {
        return formError('Wait a few seconds before sending another test.');
      }
      if (e.message === 'webhook off') {
        return formError('Turn the webhook on first.');
      }
      return null;
    },
  );
}
