'use client';

import { useState } from 'react';
import {
  DISMISS_REASONS,
  DISMISS_REASON_LABELS,
  type DismissReason,
} from '@xjobs/database/enums';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

/** The select cannot hold an empty value, so "No reason" stands for it. */
const NO_REASON = 'none';

const ITEMS = [
  { value: NO_REASON, label: 'No reason' },
  ...DISMISS_REASONS.map((r) => ({
    value: r,
    label: DISMISS_REASON_LABELS[r],
  })),
];

/**
 * "Not for me": an optional reason and note. A `false` from `onConfirm` keeps it open.
 * With `initial`, it edits an earlier dismissal: it opens on those values and saves.
 */
export function DismissDialog({
  open,
  onOpenChange,
  onConfirm,
  initial,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  onConfirm(v: { reason?: DismissReason; note?: string }): Promise<boolean>;
  initial?: { reason: DismissReason | null; note: string | null };
}) {
  const initialReason = initial?.reason ?? NO_REASON;
  const initialNote = initial?.note ?? '';
  const [reason, setReason] = useState(initialReason);
  const [note, setNote] = useState(initialNote);
  const [pending, setPending] = useState(false);
  // Each opening starts from the saved values, which may have changed since the last.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setReason(initialReason);
      setNote(initialNote);
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    let saved = false;
    try {
      saved = await onConfirm({
        reason: reason === NO_REASON ? undefined : (reason as DismissReason),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
    } catch {
      saved = false;
    } finally {
      setPending(false);
    }
    if (saved) onOpenChange(false);
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
            <DialogTitle>Not for me</DialogTitle>
            <DialogDescription>
              {initial
                ? 'Change why this job is not for you. A reason helps tune your matches.'
                : 'This job moves to Applications as dismissed. A reason helps tune your matches.'}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="dismiss-reason">
                Reason (optional)
              </FieldLabel>
              <Select
                items={ITEMS}
                value={reason}
                onValueChange={(v) => {
                  if (typeof v === 'string') setReason(v);
                }}
              >
                <SelectTrigger id="dismiss-reason" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ITEMS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="dismiss-note">Note (optional)</FieldLabel>
              <Textarea
                id="dismiss-note"
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
              {initial ? 'Save' : 'Not for me'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
