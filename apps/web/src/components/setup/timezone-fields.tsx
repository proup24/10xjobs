'use client';

import { useId } from 'react';
import {
  Field,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatOffset, TIMEZONE_OFFSETS } from '@/lib/setup/options';

/** UTC offsets in minutes; null until known (prefill runs on the client). */
export type TimezoneValue = {
  current: number | null;
  min: number | null;
  max: number | null;
};

const ITEMS = TIMEZONE_OFFSETS.map((m) => ({
  value: String(m),
  label: formatOffset(m),
}));

type Props = {
  value: TimezoneValue;
  onChange: (value: TimezoneValue) => void;
  /** Form errors by path ("timezoneCurrent", "timezoneMin", "timezoneMax"). */
  errors?: Record<string, string>;
};

function OffsetSelect({
  label,
  id,
  value,
  onChange,
}: {
  label: string;
  id?: string;
  value: number | null;
  onChange: (minutes: number) => void;
}) {
  return (
    <Select
      items={ITEMS}
      value={value === null ? null : String(value)}
      onValueChange={(v) => v !== null && onChange(Number(v))}
    >
      <SelectTrigger id={id} aria-label={label} className="w-32">
        <SelectValue placeholder="UTC…" />
      </SelectTrigger>
      <SelectContent>
        {ITEMS.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** The user's UTC offset and the range of offsets they can work with ("from UTC−1 to UTC+4"). */
export function TimezoneFields({ value, onChange, errors = {} }: Props) {
  const id = useId();
  const rangeError = errors.timezoneMin ?? errors.timezoneMax;
  return (
    <FieldSet>
      <FieldLegend variant="label">Time zone</FieldLegend>
      <Field invalid={Boolean(errors.timezoneCurrent)} required>
        <FieldLabel htmlFor={id}>Your UTC offset</FieldLabel>
        <OffsetSelect
          id={id}
          label="Your UTC offset"
          value={value.current}
          onChange={(current) => onChange({ ...value, current })}
        />
        <FieldError>{errors.timezoneCurrent}</FieldError>
      </Field>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">
          Time zones you can work with
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">from</span>
          <Field invalid={Boolean(errors.timezoneMin)} className="w-auto">
            <OffsetSelect
              label="From"
              value={value.min}
              onChange={(min) => onChange({ ...value, min })}
            />
          </Field>
          <span className="text-sm text-muted-foreground">to</span>
          <Field invalid={Boolean(errors.timezoneMax)} className="w-auto">
            <OffsetSelect
              label="To"
              value={value.max}
              onChange={(max) => onChange({ ...value, max })}
            />
          </Field>
        </div>
        <Field invalid={Boolean(rangeError)}>
          <FieldError>{rangeError}</FieldError>
        </Field>
      </div>
    </FieldSet>
  );
}
