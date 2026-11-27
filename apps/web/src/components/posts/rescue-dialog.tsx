'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { rescuePostAction, undoRescueAction } from '@/app/(app)/actions';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import type { SaveResult } from '@/lib/setup/save-result';

const refused = (result: SaveResult) =>
  toast.error(
    result.status === 'invalid' && result.errors._form
      ? result.errors._form
      : "Couldn't save. Try again.",
  );

async function run(call: () => Promise<SaveResult>): Promise<SaveResult> {
  try {
    return await call();
  } catch {
    return { status: 'failed' };
  }
}

/** The optional note before a rescue. A `false` from `onConfirm` keeps it open. */
export function RescueDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  onConfirm(note: string | undefined): Promise<boolean>;
}) {
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    let saved = false;
    try {
      saved = await onConfirm(note.trim() ? note.trim() : undefined);
    } catch {
      saved = false;
    } finally {
      setPending(false);
    }
    if (saved) {
      setNote('');
      onOpenChange(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <DialogContent>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Rescue this post</DialogTitle>
            <DialogDescription>
              It moves to Matches, where you can act on it.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="rescue-note">
                Why this one is for you (optional)
              </FieldLabel>
              <Textarea
                id="rescue-note"
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" loading={pending}>
              Rescue
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The Rescue and Undo rescue buttons of an open post. A saved rescue closes the detail
 * (`closeHref`), reads the lists again and toasts; an undo only reads them again.
 */
export function RescueControls({
  jobId,
  mode,
  closeHref,
}: {
  jobId: string;
  mode: 'rescue' | 'undo';
  closeHref: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [undoing, setUndoing] = useState(false);

  if (mode === 'undo')
    return (
      <div>
        <Button
          variant="outline"
          loading={undoing}
          onClick={async () => {
            if (undoing) return;
            setUndoing(true);
            const result = await run(() => undoRescueAction(jobId));
            setUndoing(false);
            if (result.status === 'saved') router.refresh();
            else refused(result);
          }}
        >
          Undo rescue
        </Button>
      </div>
    );

  return (
    <div>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Rescue
      </Button>
      <RescueDialog
        open={open}
        onOpenChange={setOpen}
        onConfirm={async (note) => {
          const result = await run(() => rescuePostAction({ jobId, note }));
          if (result.status !== 'saved') {
            refused(result);
            return false;
          }
          router.push(closeHref);
          router.refresh();
          toast.success('Moved to Matches');
          return true;
        }}
      />
    </div>
  );
}
