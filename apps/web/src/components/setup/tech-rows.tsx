'use client';

import { useId } from 'react';
import { StarIcon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, FieldError } from '@/components/ui/field';
import { RatingBar } from '@/components/ui/rating-bar';
import { Toggle } from '@/components/ui/toggle';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { MAX_STARRED, type TechAnswer } from '@/lib/setup/answers';
import type { TechOption } from '@/lib/setup/value-lists';

const STAR_HINT = 'Search for this';
const LIMIT_HINT = 'Up to two techs can drive search';
const NOT_SEARCHABLE_HINT = 'We can’t search for this tech';

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
 * Tech stack rows: label, a 1-5 rating, the "Search for this" star and a remove button.
 * At most two searchable techs can be starred. Stacks below `sm`.
 */
export function TechRows({ value, onChange, options, errors = {} }: Props) {
  const byCode = new Map(options.map((o) => [o.value, o]));
  const starred = value.filter((t) => t.starred).length;
  const update = (code: string, patch: Partial<TechAnswer>) =>
    onChange(value.map((t) => (t.code === code ? { ...t, ...patch } : t)));

  return (
    <div className="flex flex-col gap-3">
      {value.map((tech, i) => {
        const option = byCode.get(tech.code);
        const label = option?.label ?? tech.code;
        // A tech we don't know as an option can't be starred: we can't tell it's searchable.
        // A star already on can always be turned off.
        const blocked = tech.starred
          ? null
          : !option?.searchable
            ? NOT_SEARCHABLE_HINT
            : starred >= MAX_STARRED
              ? LIMIT_HINT
              : null;
        const error =
          errors[`techs.${i}.rating`] ??
          errors[`techs.${i}.starred`] ??
          errors[`techs.${i}.code`];
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
              <StarToggle
                label={label}
                pressed={tech.starred}
                blocked={blocked}
                onPressedChange={(next) => update(tech.code, { starred: next })}
              />
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

/**
 * The star with its tooltip. A disabled button gets no pointer or focus events, so when
 * blocked the tooltip hangs on a focusable wrapper and the button is described by the hint.
 */
function StarToggle({
  label,
  pressed,
  blocked,
  onPressedChange,
}: {
  label: string;
  pressed: boolean;
  blocked: string | null;
  onPressedChange: (pressed: boolean) => void;
}) {
  const hintId = useId();
  const toggle = (
    <Toggle
      size="sm"
      pressed={pressed}
      onPressedChange={onPressedChange}
      disabled={blocked !== null}
      aria-label={`Search for ${label}`}
      aria-describedby={blocked ? hintId : undefined}
    >
      <StarIcon className={pressed ? 'fill-current' : undefined} />
    </Toggle>
  );
  return (
    <Tooltip>
      {blocked ? (
        <TooltipTrigger render={<span tabIndex={0} />}>
          {toggle}
          <span id={hintId} className="sr-only">
            {blocked}
          </span>
        </TooltipTrigger>
      ) : (
        <TooltipTrigger render={toggle} />
      )}
      <TooltipContent>{blocked ?? STAR_HINT}</TooltipContent>
    </Tooltip>
  );
}
