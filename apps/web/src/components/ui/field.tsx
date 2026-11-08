'use client';

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
} from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';

type FieldContextValue = {
  invalid: boolean;
  required: boolean;
  descriptionId: string;
  errorId: string;
  hasDescription: boolean;
  hasError: boolean;
  setHasDescription: (value: boolean) => void;
  setHasError: (value: boolean) => void;
};

const FieldContext = createContext<FieldContextValue | null>(null);

/**
 * Wiring for controls: inside a `Field`, a control gets `aria-invalid` when the
 * field is invalid and `aria-describedby` listing the description and error that
 * are rendered. Outside a `Field` the props pass through unchanged. An explicit
 * `aria-invalid` or `aria-describedby` on the control wins or is appended to.
 */
function useFieldControl<
  P extends {
    'aria-invalid'?: unknown;
    'aria-required'?: unknown;
    'aria-describedby'?: string;
  },
>(props: P): P {
  const field = useContext(FieldContext);
  if (!field) return props;
  const ids = [
    props['aria-describedby'],
    field.hasDescription ? field.descriptionId : undefined,
    field.hasError && field.invalid ? field.errorId : undefined,
  ].filter(Boolean);
  return {
    ...props,
    'aria-invalid': props['aria-invalid'] ?? (field.invalid ? true : undefined),
    'aria-required':
      props['aria-required'] ?? (field.required ? true : undefined),
    'aria-describedby': ids.length ? ids.join(' ') : undefined,
  };
}

function useFieldInvalid() {
  return useContext(FieldContext)?.invalid ?? false;
}

function FieldSet({ className, ...props }: React.ComponentProps<'fieldset'>) {
  return (
    <fieldset
      data-slot="field-set"
      className={cn(
        'flex flex-col gap-4 has-[>[data-slot=checkbox-group]]:gap-3 has-[>[data-slot=radio-group]]:gap-3',
        className,
      )}
      {...props}
    />
  );
}

function FieldLegend({
  className,
  variant = 'legend',
  ...props
}: React.ComponentProps<'legend'> & { variant?: 'legend' | 'label' }) {
  return (
    <legend
      data-slot="field-legend"
      data-variant={variant}
      className={cn(
        'mb-1.5 font-medium data-[variant=label]:text-sm data-[variant=legend]:text-base',
        className,
      )}
      {...props}
    />
  );
}

function FieldGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="field-group"
      className={cn(
        'group/field-group @container/field-group flex w-full flex-col gap-5 data-[slot=checkbox-group]:gap-3 *:data-[slot=field-group]:gap-4',
        className,
      )}
      {...props}
    />
  );
}

const fieldVariants = cva(
  'group/field flex w-full gap-2 data-[invalid=true]:text-destructive',
  {
    variants: {
      orientation: {
        vertical: 'flex-col *:w-full [&>.sr-only]:w-auto',
        horizontal:
          'flex-row items-center has-[>[data-slot=field-content]]:items-start *:data-[slot=field-label]:flex-auto has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px',
        responsive:
          'flex-col *:w-full @md/field-group:flex-row @md/field-group:items-center @md/field-group:*:w-auto @md/field-group:has-[>[data-slot=field-content]]:items-start @md/field-group:*:data-[slot=field-label]:flex-auto [&>.sr-only]:w-auto @md/field-group:has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px',
      },
    },
    defaultVariants: {
      orientation: 'vertical',
    },
  },
);

function Field({
  className,
  orientation = 'vertical',
  invalid = false,
  required = false,
  ...props
}: React.ComponentProps<'div'> &
  VariantProps<typeof fieldVariants> & {
    invalid?: boolean;
    required?: boolean;
  }) {
  const baseId = useId();
  const [hasDescription, setHasDescription] = useState(false);
  const [hasError, setHasError] = useState(false);
  const value = useMemo(
    () => ({
      invalid,
      required,
      descriptionId: `${baseId}-description`,
      errorId: `${baseId}-error`,
      hasDescription,
      hasError,
      setHasDescription,
      setHasError,
    }),
    [baseId, invalid, required, hasDescription, hasError],
  );
  return (
    <FieldContext.Provider value={value}>
      <div
        role="group"
        data-slot="field"
        data-orientation={orientation}
        data-invalid={invalid || undefined}
        data-required={required || undefined}
        className={cn(fieldVariants({ orientation }), className)}
        {...props}
      />
    </FieldContext.Provider>
  );
}

function FieldContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="field-content"
      className={cn(
        'group/field-content flex flex-1 flex-col gap-0.5 leading-snug',
        className,
      )}
      {...props}
    />
  );
}

function FieldLabel({
  className,
  ...props
}: React.ComponentProps<typeof Label>) {
  const required = useContext(FieldContext)?.required ?? false;
  return (
    <Label
      data-slot="field-label"
      className={cn(
        'group/field-label peer/field-label flex w-fit gap-2 leading-snug group-data-[disabled=true]/field:opacity-50 has-data-checked:border-primary/30 has-data-checked:bg-primary/5 has-[>[data-slot=field]]:rounded-lg has-[>[data-slot=field]]:border has-[>[data-slot=field]]:not-has-[:disabled,[data-disabled]]:hover:bg-muted/50 has-[>[data-slot=field]]:has-[:focus-visible]:border-ring has-[>[data-slot=field]]:has-[:focus-visible]:ring-1 has-[>[data-slot=field]]:has-[:focus-visible]:ring-ring *:data-[slot=field]:p-2.5 dark:has-data-checked:border-primary/20 dark:has-data-checked:bg-primary/10',
        'has-[>[data-slot=field]]:w-full has-[>[data-slot=field]]:flex-col',
        className,
      )}
      {...props}
    >
      {props.children}
      {required ? (
        <span
          aria-hidden="true"
          data-slot="field-required"
          className="text-destructive"
        >
          *
        </span>
      ) : null}
    </Label>
  );
}

function FieldTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="field-label"
      className={cn(
        'flex w-fit items-center gap-2 text-sm font-medium group-data-[disabled=true]/field:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

function FieldDescription({
  className,
  id,
  ...props
}: React.ComponentProps<'p'>) {
  const field = useContext(FieldContext);
  const setHasDescription = field?.setHasDescription;
  useEffect(() => {
    setHasDescription?.(true);
    return () => setHasDescription?.(false);
  }, [setHasDescription]);
  return (
    <p
      id={id ?? field?.descriptionId}
      data-slot="field-description"
      className={cn(
        'text-left text-sm leading-normal font-normal text-muted-foreground group-has-data-horizontal/field:text-balance [[data-variant=legend]+&]:-mt-1.5',
        'last:mt-0 nth-last-2:-mt-1',
        '[&>a]:underline [&>a]:underline-offset-4 [&>a:hover]:text-brand',
        className,
      )}
      {...props}
    />
  );
}

function FieldSeparator({
  children,
  className,
  ...props
}: React.ComponentProps<'div'> & {
  children?: React.ReactNode;
}) {
  return (
    <div
      data-slot="field-separator"
      data-content={!!children}
      className={cn(
        'relative -my-2 h-5 text-sm group-data-[variant=outline]/field-group:-mb-2',
        className,
      )}
      {...props}
    >
      <Separator className="absolute inset-0 top-1/2" />
      {children && (
        <span
          className="relative mx-auto block w-fit bg-background px-2 text-muted-foreground"
          data-slot="field-separator-content"
        >
          {children}
        </span>
      )}
    </div>
  );
}

function FieldError({
  className,
  children,
  errors,
  ...props
}: React.ComponentProps<'div'> & {
  errors?: Array<{ message?: string } | undefined>;
}) {
  const field = useContext(FieldContext);
  const setHasError = field?.setHasError;
  // Inside a Field the error shows only while the field is invalid.
  const hidden = field ? !field.invalid : false;
  const content = useMemo(() => {
    if (children) {
      return children;
    }

    if (!errors?.length) {
      return null;
    }

    const uniqueErrors = [
      ...new Map(errors.map((error) => [error?.message, error])).values(),
    ];

    if (uniqueErrors?.length == 1) {
      return uniqueErrors[0]?.message;
    }

    return (
      <ul className="ml-4 flex list-disc flex-col gap-1">
        {uniqueErrors.map(
          (error, index) =>
            error?.message && <li key={index}>{error.message}</li>,
        )}
      </ul>
    );
  }, [children, errors]);

  const shown = Boolean(content) && !hidden;
  useEffect(() => {
    if (!shown) return;
    setHasError?.(true);
    return () => setHasError?.(false);
  }, [shown, setHasError]);

  if (!shown) {
    return null;
  }

  return (
    <div
      id={props.id ?? field?.errorId}
      role="alert"
      data-slot="field-error"
      className={cn('text-sm font-normal text-destructive', className)}
      {...props}
    >
      {content}
    </div>
  );
}

export {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldContent,
  FieldTitle,
  useFieldControl,
  useFieldInvalid,
};
