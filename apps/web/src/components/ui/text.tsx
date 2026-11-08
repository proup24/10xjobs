import Link from 'next/link';
import { cn } from '@/lib/utils';

export function Code({ className, ...props }: React.ComponentProps<'code'>) {
  return (
    <code
      data-slot="code"
      className={cn(
        'rounded-sm border border-input bg-muted px-1 py-0.5 font-mono text-[0.9em]',
        className,
      )}
      {...props}
    />
  );
}

export function Mark({ className, ...props }: React.ComponentProps<'mark'>) {
  return (
    <mark
      data-slot="mark"
      className={cn(
        'rounded-sm bg-mark px-0.5 text-mark-foreground',
        className,
      )}
      {...props}
    />
  );
}

export function TextLink({
  className,
  ...props
}: React.ComponentProps<typeof Link>) {
  return (
    <Link
      data-slot="text-link"
      className={cn(
        'rounded-sm text-brand underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
      {...props}
    />
  );
}
