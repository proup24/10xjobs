import { SETUP_STEPS } from '@/lib/setup/steps';
import { StepFrame } from '@/components/setup/step-frame';
import { requireSetupStep } from '../guard';

export const dynamic = 'force-dynamic';

const STEP = 'about';

export default async function Page() {
  await requireSetupStep(STEP);
  const label = SETUP_STEPS.find((s) => s.id === STEP)?.label ?? STEP;
  return (
    <StepFrame step={STEP} title={label} pending={false} formId="setup-form" />
  );
}
