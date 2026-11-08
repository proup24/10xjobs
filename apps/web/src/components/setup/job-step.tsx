'use client';

import { useState, type ComponentProps } from 'react';
import { useRouter } from 'next/navigation';
import { SETUP_STEPS, stepPath } from '@/lib/setup/steps';
import { JobForm } from './job-form';
import { StepFrame } from './step-frame';
import type { StepStatus } from './step-status';

const FORM_ID = 'job-form';
const LEAD = 'We only show you jobs that match every answer here.';

type Props = Omit<
  ComponentProps<typeof JobForm>,
  'formId' | 'onSaved' | 'onStatusChange'
>;

/** Step 3 in the setup flow: the frame around the form, then on to the next step. */
export function JobStep(props: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<StepStatus>({ pending: false });
  return (
    <StepFrame
      step="job"
      title={SETUP_STEPS[2].label}
      lead={LEAD}
      pending={status.pending}
      formId={FORM_ID}
      formError={status.formError}
    >
      <JobForm
        {...props}
        formId={FORM_ID}
        onStatusChange={setStatus}
        onSaved={() => router.push(stepPath('terms'))}
      />
    </StepFrame>
  );
}
