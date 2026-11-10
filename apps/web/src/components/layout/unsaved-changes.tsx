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
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

type UnsavedChanges = {
  /** Stable identity: safe in effect deps and cleanups. */
  setDirty: (dirty: boolean) => void;
  /** Runs `go` now when clean; otherwise asks "Discard changes?" first. */
  confirmLeave: (go: () => void) => void;
};

const UnsavedChangesContext = React.createContext<UnsavedChanges | null>(null);

/** A click the browser should handle itself: a new tab or window, not a page change. */
export function opensElsewhere(event: { preventDefault(): void }): boolean {
  if (!('button' in event)) return false;
  const e = event as React.MouseEvent;
  return e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;
}

/**
 * Tracks whether the page has unsaved edits. While dirty, a page unload asks
 * the browser to confirm and in-app navigation asks through `confirmLeave`.
 */
export function UnsavedChangesProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [dirty, setDirtyState] = React.useState(false);
  const dirtyRef = React.useRef(false);
  const [pending, setPending] = React.useState<(() => void) | null>(null);

  const setDirty = React.useCallback((next: boolean) => {
    dirtyRef.current = next;
    setDirtyState(next);
  }, []);

  const confirmLeave = React.useCallback((go: () => void) => {
    if (!dirtyRef.current) {
      go();
      return;
    }
    // Wrapped: a bare function would be taken as a state updater.
    setPending(() => go);
  }, []);

  React.useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = ''; // some browsers only prompt when this is set
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const value = React.useMemo(
    () => ({ setDirty, confirmLeave }),
    [setDirty, confirmLeave],
  );

  return (
    <UnsavedChangesContext.Provider value={value}>
      {children}
      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard changes?</AlertDialogTitle>
            <AlertDialogDescription>
              Your changes on this page haven&apos;t been saved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={() => {
                const go = pending;
                setDirty(false);
                setPending(null);
                go?.();
              }}
            >
              Discard
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </UnsavedChangesContext.Provider>
  );
}

/** Must be used inside `UnsavedChangesProvider`; throws otherwise. */
export function useUnsavedChanges(): UnsavedChanges {
  const ctx = React.useContext(UnsavedChangesContext);
  if (!ctx) {
    throw new Error(
      'useUnsavedChanges must be used inside UnsavedChangesProvider',
    );
  }
  return ctx;
}
