'use client';

import { useId } from 'react';
import { PlusIcon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Picker, type PickerOption } from '@/components/ui/picker';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { TermsAnswers } from '@/lib/setup/answers';

export type SalaryPeriod = NonNullable<TermsAnswers['salary']>['period'];

/** The salary as the form holds it; null while collapsed (no minimum salary). */
export type SalaryDraft = {
  min: string;
  currency: string | null;
  period: SalaryPeriod | null;
} | null;

const PERIODS = [
  { value: 'hour', label: 'Hour' },
  { value: 'day', label: 'Day' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
] as const;

type Props = {
  value: SalaryDraft;
  onChange: (value: SalaryDraft) => void;
  currencies: PickerOption[];
  /** Form errors by path ("salary.min", "salary.currency", "salary.period"). */
  errors?: Record<string, string>;
};

/** Optional minimum salary: collapsed under a button; open, an amount, a currency and a period. */
export function SalaryFields({
  value,
  onChange,
  currencies,
  errors = {},
}: Props) {
  const ids = useId();
  if (value === null) {
    return (
      <Button
        type="button"
        variant="dashed"
        className="self-start"
        onClick={() => onChange({ min: '', currency: null, period: null })}
      >
        <PlusIcon />
        Add a minimum salary
      </Button>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">Minimum salary</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Remove minimum salary"
          onClick={() => onChange(null)}
        >
          <XIcon />
        </Button>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <Field invalid={Boolean(errors['salary.min'])} className="sm:w-40">
          <FieldLabel htmlFor={`${ids}-min`}>Amount</FieldLabel>
          <Input
            id={`${ids}-min`}
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={value.min}
            onChange={(e) => onChange({ ...value, min: e.target.value })}
          />
          <FieldError>{errors['salary.min']}</FieldError>
        </Field>
        <Field
          invalid={Boolean(errors['salary.currency'])}
          className="sm:flex-1"
        >
          <FieldLabel htmlFor={`${ids}-currency`}>Currency</FieldLabel>
          <Picker
            id={`${ids}-currency`}
            aria-label="Salary currency"
            options={currencies}
            value={value.currency}
            onValueChange={(currency) => onChange({ ...value, currency })}
            placeholder="Search currencies"
            emptyText="No currency found"
            aria-invalid={errors['salary.currency'] ? true : undefined}
          />
          <FieldError>{errors['salary.currency']}</FieldError>
        </Field>
        <Field invalid={Boolean(errors['salary.period'])} className="sm:w-32">
          <FieldLabel htmlFor={`${ids}-period`}>Per</FieldLabel>
          <Select
            items={PERIODS}
            value={value.period}
            onValueChange={(period) =>
              period && onChange({ ...value, period: period as SalaryPeriod })
            }
          >
            <SelectTrigger
              id={`${ids}-period`}
              aria-label="Per"
              className="w-full"
            >
              <SelectValue placeholder="Period" />
            </SelectTrigger>
            <SelectContent>
              {PERIODS.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError>{errors['salary.period']}</FieldError>
        </Field>
      </div>
    </div>
  );
}
