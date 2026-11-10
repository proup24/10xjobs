'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useUnsavedChanges } from '@/components/layout/unsaved-changes';
import type { StepStatus } from '@/components/setup/step-status';
import { Button } from '@/components/ui/button';

/** What a Section hands its form; every callback is stable. */
export type SectionFormProps = {
  formId: string;
  onStatusChange: (status: StepStatus) => void;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: () => void;
};

type Props = {
  title: string;
  lead?: string;
  /** The title's heading level: 3 under a profile's own heading. */
  level?: 2 | 3;
  /** The `<form>` id the Save button targets. */
  formId: string;
  children: (props: SectionFormProps) => React.ReactNode;
};

/**
 * The frame for one form outside setup: title, lead, the form, its `_form` error and a
 * "Save changes" button. Unsaved edits go to the page's unsaved-changes guard; a save
 * toasts "Saved", keeps the user here and refreshes the server data (e.g. nav labels).
 */
export function Section({ title, lead, level = 2, formId, children }: Props) {
  const Heading = level === 2 ? 'h2' : 'h3';
  const router = useRouter();
  const headingId = useId();
  const { setDirty } = useUnsavedChanges();
  const [status, setStatus] = useState<StepStatus>({ pending: false });

  // A section that goes away takes its edits with it: don't leave the guard dirty.
  useEffect(() => () => setDirty(false), [setDirty]);

  const onSaved = useCallback(() => {
    setDirty(false);
    toast.success('Saved');
    router.refresh();
  }, [router, setDirty]);

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Heading
          id={headingId}
          className={level === 2 ? 'text-title-4' : 'text-title-5'}
        >
          {title}
        </Heading>
        {lead && <p className="text-muted-foreground">{lead}</p>}
      </div>
      {children({
        formId,
        onStatusChange: setStatus,
        onDirtyChange: setDirty,
        onSaved,
      })}
      {status.formError && (
        <p
          role="alert"
          className="text-sm whitespace-pre-line text-destructive"
        >
          {status.formError}
        </p>
      )}
      <div className="flex justify-end">
        <Button type="submit" form={formId} loading={status.pending}>
          Save changes
        </Button>
      </div>
    </section>
  );
}
