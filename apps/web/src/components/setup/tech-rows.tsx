'use client';

import { XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, FieldError } from '@/components/ui/field';
import { RatingBar } from '@/components/ui/rating-bar';
import type { TechAnswer } from '@/lib/setup/answers';
import type { TechOption } from '@/lib/setup/value-lists';

type Rating = NonNullable<TechAnswer['rating']>;

type Props = {
  value: TechAnswer[];
  onChange: (value: TechAnswer[]) => void;
  /** Labels and searchability of the techs. */
  options: TechOption[];
  /** Form errors by path ("techs.1.rating"). */
  errors?: Record<string, string>;
};

/**
 * Tech stack rows: label, a 1-5 rating and a remove button. Stacks below `sm`.
 */
export function TechRows({ value, onChange, options, errors = {} }: Props) {
  const byCode = new Map(options.map((o) => [o.value, o]));
  const update = (code: string, patch: Partial<TechAnswer>) =>
    onChange(value.map((t) => (t.code === code ? { ...t, ...patch } : t)));

  return (
    <div className="flex flex-col gap-3">
      {value.map((tech, i) => {
        const option = byCode.get(tech.code);
        const label = option?.label ?? tech.code;
        const error = errors[`techs.${i}.rating`] ?? errors[`techs.${i}.code`];
        return (
          <div
            key={tech.code}
            className="flex flex-col gap-2 sm:flex-row sm:items-start"
          >
            <span className="min-w-0 text-sm font-medium break-words sm:w-40 sm:shrink-0 sm:pt-2">
              {label}
            </span>
            <Field invalid={Boolean(error)} className="sm:flex-1">
              <RatingBar
                aria-label={`${label} mastery`}
                value={tech.rating}
                onValueChange={(rating) =>
                  update(tech.code, { rating: rating as Rating })
                }
                lowLabel="1 = learning"
                highLabel="5 = expert"
              />
              <FieldError>{error}</FieldError>
            </Field>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${label}`}
                onClick={() =>
                  onChange(value.filter((t) => t.code !== tech.code))
                }
              >
                <XIcon />
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
