// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteWebhook,
  rotateWebhookSecret,
  saveWebhookUrl,
  sendWebhookTest,
  setWebhookEnabled,
} from './actions';

type Rpc = { data: unknown; error: unknown };

const getClaims = vi.fn();
const rpc = vi.fn<(name: string, args?: unknown) => Promise<Rpc>>();
const client = { auth: { getClaims }, rpc };
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => client,
}));

const SAVED = { status: 'saved' };
const FAILED = { status: 'failed' };
const URL = 'https://hooks.example.com/a';

beforeEach(() => {
  vi.clearAllMocks();
  getClaims.mockResolvedValue({ data: { claims: { sub: 'user-1' } } });
  rpc.mockResolvedValue({ data: null, error: null });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

const refuse = (code: string, message: string) =>
  rpc.mockResolvedValue({ data: null, error: { code, message } });

describe('webhook actions', () => {
  it.each([
    [
      'saveWebhookUrl',
      () => saveWebhookUrl(URL),
      'webhook_save',
      { p_url: URL },
    ],
    [
      'setWebhookEnabled(true)',
      () => setWebhookEnabled(true),
      'webhook_set_enabled',
      { p_enabled: true },
    ],
    [
      'setWebhookEnabled(false)',
      () => setWebhookEnabled(false),
      'webhook_set_enabled',
      { p_enabled: false },
    ],
    [
      'rotateWebhookSecret',
      () => rotateWebhookSecret(),
      'webhook_rotate_secret',
      undefined,
    ],
    ['deleteWebhook', () => deleteWebhook(), 'webhook_delete', undefined],
    [
      'sendWebhookTest',
      () => sendWebhookTest(),
      'webhook_send_test',
      undefined,
    ],
  ] as const)('%s calls %s', async (_, call, name, args) => {
    expect(await call()).toEqual(SAVED);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]).toEqual(args ? [name, args] : [name]);
  });

  it('saveWebhookUrl trims the URL', async () => {
    await saveWebhookUrl(`  ${URL} `);
    expect(rpc).toHaveBeenCalledWith('webhook_save', { p_url: URL });
  });

  it('saveWebhookUrl refuses a non-string without calling the RPC', async () => {
    const r = await saveWebhookUrl(42 as never);
    expect(r).toEqual({
      status: 'invalid',
      errors: { url: expect.any(String) },
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('maps 22023 to an invalid url', async () => {
    refuse('22023', 'invalid webhook url');
    const r = await saveWebhookUrl('https://10.0.0.1/a');
    expect(r).toEqual({
      status: 'invalid',
      errors: { url: 'Use a host name, not an IP address.' },
    });
  });

  it('maps 22023 on a URL the client rule accepts to a generic url message', async () => {
    refuse('22023', 'invalid webhook url');
    const r = await saveWebhookUrl(URL);
    expect(r).toEqual({
      status: 'invalid',
      errors: { url: "This URL can't be used for a webhook." },
    });
  });

  it('maps too soon to wait a few seconds', async () => {
    refuse('P0001', 'too soon');
    expect(await sendWebhookTest()).toEqual({
      status: 'invalid',
      errors: { _form: 'Wait a few seconds before sending another test.' },
    });
  });

  it('maps webhook off to turn it on first', async () => {
    refuse('P0001', 'webhook off');
    expect(await sendWebhookTest()).toEqual({
      status: 'invalid',
      errors: { _form: 'Turn the webhook on first.' },
    });
  });

  it('fails on any other error and logs the code only', async () => {
    refuse('XX000', 'secret detail');
    expect(await rotateWebhookSecret()).toEqual(FAILED);
    const logged = vi.mocked(console.error).mock.calls.join();
    expect(logged).toContain('XX000');
    expect(logged).not.toContain('secret detail');
  });

  it('fails without a session and calls nothing', async () => {
    getClaims.mockResolvedValue({ data: null });
    expect(await saveWebhookUrl(URL)).toEqual(FAILED);
    expect(await setWebhookEnabled(true)).toEqual(FAILED);
    expect(await rotateWebhookSecret()).toEqual(FAILED);
    expect(await deleteWebhook()).toEqual(FAILED);
    expect(await sendWebhookTest()).toEqual(FAILED);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('setWebhookEnabled refuses a non-boolean', async () => {
    expect(await setWebhookEnabled('yes' as never)).toEqual(FAILED);
    expect(rpc).not.toHaveBeenCalled();
  });
});
