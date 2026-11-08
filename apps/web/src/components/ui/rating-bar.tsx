'use client';

import { Radio as RadioPrimitive } from '@base-ui/react/radio';
import { RadioGroup as RadioGroupPrimitive } from '@base-ui/react/radio-group';
import { useId } from 'react';
import { useFieldControl } from '@/components/ui/field';
import { cn } from '@/lib/utils';

type RatingBarProps = {
  value: number | null;
  onValueChange: (value: number) => void;
  max?: number;
  lowLabel?: string;
  highLabel?: string;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
};

function RatingBar({
  value,
  onValueChange,
  max = 5,
  lowLabel,
  highLabel,
  disabled,
  className,
  ...rest
}: RatingBarProps) {
  const labelsId = useId();
  const hasLabels = Boolean(lowLabel || highLabel);
  // The end labels describe the group too, next to any Field description or error.
  const describedBy =
    [rest['aria-describedby'], hasLabels ? labelsId : undefined]
      .filter(Boolean)
      .join(' ') || undefined;
  const props = useFieldControl({ ...rest, 'aria-describedby': describedBy });
  return (
    <div
      data-slot="rating-bar"
      className={cn('flex w-full max-w-72 flex-col gap-1', className)}
    >
      <RadioGroupPrimitive
        value={value}
        onValueChange={(v) => onValueChange(Number(v))}
        disabled={disabled}
        className="group/rating flex w-full"
        {...props}
      >
        {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
          <RadioPrimitive.Root
            key={n}
            value={n}
            data-slot="rating-bar-item"
            className="flex h-9 min-w-0 flex-1 cursor-pointer items-center justify-center border border-input text-sm outline-none first:rounded-l-sm last:rounded-r-sm not-first:-ml-px hover:bg-accent focus-visible:z-10 focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 group-aria-invalid/rating:border-destructive data-checked:z-10 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground"
          >
            {n}
          </RadioPrimitive.Root>
        ))}
      </RadioGroupPrimitive>
      {hasLabels ? (
        <div
          id={labelsId}
          className="flex justify-between gap-2 text-xs text-muted-foreground"
        >
          <span>{lowLabel}</span>
          <span className="text-right">{highLabel}</span>
        </div>
      ) : null}
    </div>
  );
}

export { RatingBar };
export type { RatingBarProps };
