'use client';

import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox';
import { useFieldControl } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import { CheckIcon } from 'lucide-react';

function Checkbox({ className, ...rest }: CheckboxPrimitive.Root.Props) {
  const props = useFieldControl(rest);
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'peer relative flex size-3.5 shrink-0 items-center justify-center rounded-sm border border-input hover:border-brand transition-colors outline-none group-has-disabled/field:opacity-50 group-has-[:focus-visible]/field-label:ring-0 group-has-[:focus-visible]/field-label:not-data-checked:border-input after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 aria-invalid:aria-checked:border-brand dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-checked:border-brand data-checked:bg-brand data-checked:text-background group-has-[:focus-visible]/field-label:data-checked:border-brand',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none [&>svg]:size-3"
      >
        <CheckIcon />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
