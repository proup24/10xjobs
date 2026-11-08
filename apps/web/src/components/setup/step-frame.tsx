'use client';

import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Steps } from '@/components/ui/steps';
import { SETUP_STEPS, type SetupStepId } from '@/lib/setup/steps';

const STEPS = [...SETUP_STEPS, { id: 'review', label: 'Review' }];

/** The toast for `{status:'failed'}`; step forms call it, nothing else does. */
export function notifySaveFailed() {
  toast.error("Couldn't save. Try again.");
}

type StepFrameProps = {
  step: SetupStepId | 'review';
  title: string;
  lead?: string;
  children?: React.ReactNode;
  /** Defaults to the previous step's URL; pass it to override. Hidden on step 1. */
  onBack?: () => void;
  submitLabel?: string;
  /** The form's pending state; shows the loading button. */
  pending: boolean;
  /** The id of the step's `<form>`; the footer submit button targets it. */
  formId: string;
  /** A form-level error (`errors._form`), shown as an alert above the footer. */
  formError?: string;
};

/**
 * The frame every setup step renders in: progress, title, lead, the step's form as
 * children, and a footer with Back and the submit button.
 *
 * Convention for step forms (Tasks 8-11): give the `<form>` an `id` and pass it as
 * `formId`, plus the action's `pending` state. On a save result, `{status:'failed'}`
 * calls `notifySaveFailed()`; `{status:'invalid'}` shows `errors` on the fields, with
 * `errors._form` passed as `formError`. Do not toast invalid results.
 */
export function StepFrame({
  step,
  title,
  lead,
  children,
  onBack,
  submitLabel = 'Continue',
  pending,
  formId,
  formError,
}: StepFrameProps) {
  const router = useRouter();
  const index = STEPS.findIndex((s) => s.id === step);
  const previous = index > 0 ? STEPS[index - 1].id : null;
  // On review every setup step is done; the frame shows review as the current one.
  return (
    <div className="flex flex-col gap-6">
      <Steps steps={STEPS} current={index} />
      <div className="flex flex-col gap-2">
        <h1 className="text-title-3">{title}</h1>
        {lead && <p className="text-muted-foreground">{lead}</p>}
      </div>
      {children}
      {formError && (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      )}
      <div className="flex items-center justify-between gap-2">
        {previous ? (
          <Button
            type="button"
            variant="ghost"
            onClick={onBack ?? (() => router.push(`/setup/${previous}`))}
          >
            Back
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" form={formId} loading={pending}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
