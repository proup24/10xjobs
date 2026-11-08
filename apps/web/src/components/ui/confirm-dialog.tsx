'use client';

import * as React from 'react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from './alert-dialog';
import { Button } from './button';

type ConfirmDialogProps = {
  trigger: React.ReactElement;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
  /** Called when `onConfirm` throws or rejects. Defaults to `console.error`. */
  onError?: (error: unknown) => void;
};

/**
 * Asks "are you sure?" before an action. The confirm button shows a spinner
 * while `onConfirm` is pending; the dialog closes when it resolves and stays
 * open when it rejects (the caller reports the error, e.g. with a toast).
 */
function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  destructive = false,
  onConfirm,
  onError,
}: ConfirmDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const inFlight = React.useRef(false);

  async function handleConfirm() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    try {
      await onConfirm();
      setOpen(false);
    } catch (error) {
      // Stay open so the user can retry or cancel.
      if (onError) onError(error);
      else console.error(error);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) setOpen(next);
      }}
    >
      <AlertDialogTrigger render={trigger} />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            loading={pending}
            onClick={handleConfirm}
          >
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export { ConfirmDialog };
export type { ConfirmDialogProps };
