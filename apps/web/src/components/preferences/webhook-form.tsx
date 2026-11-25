'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useUnsavedChanges } from '@/components/layout/unsaved-changes';
import { notifySaveFailed } from '@/components/setup/step-frame';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Code, TextLink } from '@/components/ui/text';
import type { SaveResult } from '@/lib/setup/save-result';
import { cn } from '@/lib/utils';
import {
  deleteWebhook,
  rotateWebhookSecret,
  saveWebhookUrl,
  sendWebhookTest,
  setWebhookEnabled,
} from '@/lib/webhook/actions';
import type { WebhookView } from '@/lib/webhook/load';
import { formatDeliveryTime } from '@/components/preferences/webhook-deliveries';
import { urlProblem } from '@/lib/webhook/url';

const MASK = '••••••••••••';

type Busy = 'save' | 'toggle' | 'test' | null;

/** The status line: on, off by the user, or off because sends kept failing. */
export function webhookStatus(w: WebhookView): {
  text: string;
  tone: 'on' | 'off' | 'failing';
} {
  if (w.enabled) return { text: 'On', tone: 'on' };
  if (w.disabledReason === 'failing') {
    return { text: 'Off: turned off after 10 failed sends.', tone: 'failing' };
  }
  return { text: 'Off', tone: 'off' };
}

const DOT = {
  on: 'bg-success',
  off: 'bg-muted-foreground',
  failing: 'bg-destructive',
} as const;

/** One labelled row: the label beside its content from `sm` up, above it below. */
function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <span className="shrink-0 font-medium sm:w-20">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        {children}
      </div>
    </div>
  );
}

/**
 * The webhook's URL, on/off switch, signing secret and test send. Without a webhook only
 * the URL shows; saving one creates it, on. Each action refreshes the server data.
 */
export function WebhookForm({
  webhook,
  callbackUrl,
  docsUrl,
}: {
  webhook: WebhookView | null;
  callbackUrl: string;
  docsUrl?: string;
}) {
  const router = useRouter();
  const { setDirty } = useUnsavedChanges();
  const saved = webhook?.url ?? '';
  const [url, setUrl] = useState(saved);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);

  useEffect(() => {
    setDirty(url.trim() !== saved);
  }, [url, saved, setDirty]);
  // Leaving the page takes the edit with it: don't leave the guard dirty.
  useEffect(() => () => setDirty(false), [setDirty]);

  /** Runs an action; true when it saved. A form-level refusal toasts its message. */
  async function act(
    kind: Busy,
    action: () => Promise<SaveResult>,
    onSaved?: () => void,
  ): Promise<boolean> {
    setBusy(kind);
    try {
      const r = await action();
      if (r.status === 'saved') {
        onSaved?.();
        router.refresh();
        return true;
      }
      if (r.status === 'invalid') {
        if (r.errors.url) setUrlError(r.errors.url);
        else toast.error(r.errors._form ?? "Couldn't save. Try again.");
      } else notifySaveFailed();
      return false;
    } catch {
      notifySaveFailed();
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const value = url.trim();
    const problem = urlProblem(value);
    setUrlError(problem);
    if (problem) return;
    await act(
      'save',
      () => saveWebhookUrl(value),
      () => {
        setDirty(false);
        toast.success('Saved');
      },
    );
  }

  async function copySecret() {
    if (!webhook) return;
    try {
      await navigator.clipboard.writeText(webhook.secret);
      toast.success('Copied');
    } catch {
      toast.error("Couldn't copy. Show the secret and copy it by hand.");
    }
  }

  async function copyId() {
    if (!webhook) return;
    try {
      await navigator.clipboard.writeText(webhook.id);
      toast.success('Copied');
    } catch {
      toast.error("Couldn't copy. Select the ID and copy it by hand.");
    }
  }

  const status = webhook ? webhookStatus(webhook) : null;

  return (
    <div className="flex flex-col gap-6">
      <form noValidate onSubmit={onSubmit}>
        <Field invalid={urlError !== null}>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <FieldLabel
              htmlFor="webhook-url"
              className="shrink-0 sm:w-20 sm:pt-2"
            >
              URL
            </FieldLabel>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="flex gap-2">
                <Input
                  id="webhook-url"
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="https://hooks.zapier.com/…"
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    setUrlError(null);
                  }}
                />
                <Button type="submit" loading={busy === 'save'}>
                  Save
                </Button>
              </div>
              <FieldError>{urlError}</FieldError>
            </div>
          </div>
        </Field>
      </form>

      {webhook && status && (
        <>
          <Row label="Status">
            <span className="inline-flex min-w-0 items-center gap-2">
              <span
                aria-hidden
                className={cn('size-2 shrink-0 rounded-full', DOT[status.tone])}
              />
              <span>{status.text}</span>
            </span>
            <Button
              variant="outline"
              size="sm"
              loading={busy === 'toggle'}
              onClick={() =>
                act('toggle', () => setWebhookEnabled(!webhook.enabled))
              }
            >
              {webhook.enabled ? 'Turn off' : 'Turn on'}
            </Button>
          </Row>

          <Row label="Secret">
            <Code className="min-w-0 break-all">
              {showSecret ? webhook.secret : MASK}
            </Code>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                aria-pressed={showSecret}
                onClick={() => setShowSecret((s) => !s)}
              >
                {showSecret ? 'Hide' : 'Show'}
              </Button>
              <Button variant="outline" size="sm" onClick={copySecret}>
                Copy
              </Button>
              <ConfirmDialog
                title="Rotate the secret?"
                description="The current secret stops working at once. Update your receiver with the new one."
                confirmLabel="Rotate secret"
                onConfirm={async () => {
                  await act(null, rotateWebhookSecret, () =>
                    toast.success('Secret rotated'),
                  );
                }}
                trigger={
                  <Button variant="outline" size="sm">
                    Rotate
                  </Button>
                }
              />
            </div>
          </Row>

          <Row label="ID">
            <Code className="min-w-0 break-all">{webhook.id}</Code>
            <Button variant="outline" size="sm" onClick={copyId}>
              Copy ID
            </Button>
          </Row>

          <Row label="Callback">
            <Code className="min-w-0 break-all">{callbackUrl}</Code>
            <span className="text-muted-foreground">
              {webhook.lastCallbackAt
                ? `Last callback: ${formatDeliveryTime(webhook.lastCallbackAt, 'UTC')} UTC`
                : 'Last callback: Never'}
            </span>
            {docsUrl && (
              <TextLink
                href={`${docsUrl}#calling-back`}
                target="_blank"
                rel="noopener noreferrer"
              >
                How to call back
              </TextLink>
            )}
          </Row>

          <div className="flex flex-wrap justify-between gap-2 sm:pl-22">
            <Button
              variant="secondary"
              loading={busy === 'test'}
              onClick={() =>
                act('test', sendWebhookTest, () => toast.success('Test queued'))
              }
            >
              Send test
            </Button>
            <ConfirmDialog
              destructive
              title="Remove the webhook?"
              description="We stop sending matches to this URL and delete its delivery history."
              confirmLabel="Remove webhook"
              onConfirm={async () => {
                await act(null, deleteWebhook, () => {
                  setUrl('');
                  toast.success('Webhook removed');
                });
              }}
              trigger={<Button variant="ghost">Remove webhook</Button>}
            />
          </div>
        </>
      )}
    </div>
  );
}
