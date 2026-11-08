'use client';

import { XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, FieldError } from '@/components/ui/field';
import type { PickerOption } from '@/components/ui/picker';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { LANGUAGE_LEVELS, type JobAnswers } from '@/lib/setup/answers';
import { LEVEL_LABELS } from '@/lib/setup/labels';

type Level = JobAnswers['languages'][number]['level'];

/** A row as the form holds it; `level` is null until picked. */
export type LanguageRow = { lang: string; level: Level | null };

const LEVEL_ITEMS = LANGUAGE_LEVELS.map((value) => ({
  value,
  label: LEVEL_LABELS[value],
}));

type Props = {
  value: LanguageRow[];
  onChange: (value: LanguageRow[]) => void;
  /** Labels of the languages. */
  options: PickerOption[];
  /** Form errors by path ("languages.1.level", "languages.1.lang"). */
  errors?: Record<string, string>;
};

/** Language rows: label, a level Select (empty until picked) and a remove button. Stacks below `sm`. */
export function LanguageRows({ value, onChange, options, errors = {} }: Props) {
  const byCode = new Map(options.map((o) => [o.value, o.label]));
  return (
    <div className="flex flex-col gap-3">
      {value.map((row, i) => {
        const label = byCode.get(row.lang) ?? row.lang;
        const error =
          errors[`languages.${i}.level`] ??
          errors[`languages.${i}.lang`] ??
          errors[`languages.${i}`];
        return (
          <div
            key={row.lang}
            className="flex flex-col gap-2 sm:flex-row sm:items-start"
          >
            <span className="min-w-0 text-sm font-medium break-words sm:w-40 sm:shrink-0 sm:pt-2">
              {label}
            </span>
            <Field invalid={Boolean(error)} className="sm:flex-1">
              <Select
                items={LEVEL_ITEMS}
                value={row.level}
                onValueChange={(level) =>
                  level &&
                  onChange(
                    value.map((l) =>
                      l.lang === row.lang ? { ...l, level: level as Level } : l,
                    ),
                  )
                }
              >
                <SelectTrigger
                  aria-label={`${label} level`}
                  className="w-full sm:w-40"
                >
                  <SelectValue placeholder="Pick a level" />
                </SelectTrigger>
                <SelectContent>
                  {LEVEL_ITEMS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError>{error}</FieldError>
            </Field>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="self-end sm:self-auto"
              aria-label={`Remove ${label}`}
              onClick={() => onChange(value.filter((l) => l.lang !== row.lang))}
            >
              <XIcon />
            </Button>
          </div>
        );
      })}
    </div>
  );
}
