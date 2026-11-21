'use client';

import { useId, useState, useTransition } from 'react';
import { toast } from 'sonner';
import {
  silenceAuthorAction,
  unsilenceAuthorAction,
} from '@/app/(app)/admin/prepare/actions';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';

const MAX_REASON = 1000;

/**
 * Silences a post author after asking why. The page revalidates on success; a failure
 * keeps the dialog open with a toast.
 */
export function SilenceButton({
  authorKey,
  name,
}: {
  authorKey: string;
  name: string | null;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [missing, setMissing] = useState(false);
  const [pending, setPending] = useState(false);
  const who = name ?? authorKey;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pending) return;
    if (!reason.trim()) {
      setMissing(true);
      return;
    }
    setMissing(false);
    setPending(true);
    let result: 'saved' | 'failed' = 'failed';
    try {
      result = await silenceAuthorAction({ authorKey, name, reason });
    } catch {
      // Treated as a failure below.
    } finally {
      setPending(false);
    }
    if (result === 'saved') {
      setOpen(false);
      setReason('');
      return;
    }
    toast.error("Couldn't silence this author. Try again.");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) setOpen(next);
      }}
    >
      <DialogTrigger render={<Button variant="outline" size="xs" />}>
        Silence
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Silence {who}</DialogTitle>
            <DialogDescription>
              Their posts are held from now on and no longer reach matching.
            </DialogDescription>
          </DialogHeader>
          <Field required invalid={missing}>
            <FieldLabel htmlFor={id}>Reason</FieldLabel>
            <Textarea
              id={id}
              maxLength={MAX_REASON}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <FieldError>Give a reason.</FieldError>
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" loading={pending}>
              Silence
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Un-silences a post author; a failure shows a toast. */
export function UnsilenceButton({
  authorKey,
  name,
}: {
  authorKey: string;
  name: string | null;
}) {
  const [pending, startTransition] = useTransition();

  const click = () =>
    startTransition(async () => {
      let result: 'saved' | 'failed' = 'failed';
      try {
        result = await unsilenceAuthorAction(authorKey);
      } catch {
        // Treated as a failure below.
      }
      if (result !== 'saved')
        toast.error("Couldn't un-silence this author. Try again.");
    });

  return (
    <Button
      variant="outline"
      size="xs"
      loading={pending}
      onClick={click}
      aria-label={`Un-silence ${name ?? authorKey}`}
    >
      Un-silence
    </Button>
  );
}
