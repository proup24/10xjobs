import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

type Step = { id: string; label: string };

type StepsProps = {
  steps: Step[];
  /** Zero-based index of the current step. Out-of-range values are clamped. */
  current: number;
  className?: string;
};

function Steps({ steps, current, className }: StepsProps) {
  if (steps.length === 0) return null;
  const index = Number.isFinite(current)
    ? Math.min(Math.max(Math.trunc(current), 0), steps.length - 1)
    : 0;

  return (
    <div data-slot="steps" className={className}>
      {/* Visual-only summary below sm; the list below is the accessible form. */}
      <p aria-hidden="true" className="text-sm font-medium sm:hidden">
        Step {index + 1} of {steps.length} · {steps[index].label}
      </p>
      {/* Below sm the list is visually hidden (sr-only), not removed, so
          assistive tech reads it at every width and never the summary too.
          From sm up it wraps whole steps onto new rows; a label never breaks. */}
      <ol className="max-sm:sr-only sm:flex sm:flex-wrap sm:items-center sm:gap-x-2 sm:gap-y-3">
        {steps.map((step, i) => {
          const done = i < index;
          const isCurrent = i === index;
          return (
            <li
              key={step.id}
              aria-current={isCurrent ? 'step' : undefined}
              className={cn(
                'flex items-center gap-2 text-sm whitespace-nowrap',
                isCurrent
                  ? 'font-medium text-foreground'
                  : 'text-muted-foreground',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-full border text-xs',
                  done && 'border-success bg-success text-success-foreground',
                  isCurrent && 'border-brand text-brand',
                  !done && !isCurrent && 'border-border bg-muted',
                )}
              >
                {done ? <Check className="size-3" /> : i + 1}
              </span>
              <span>{step.label}</span>
              {done && <span className="sr-only">(done)</span>}
              {i < steps.length - 1 && (
                <span
                  aria-hidden="true"
                  className="mx-1 hidden h-px w-6 bg-border sm:block"
                />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export { Steps };
export type { StepsProps, Step };
