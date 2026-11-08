'use client';

import { PlusIcon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, FieldError } from '@/components/ui/field';
import { Picker, type PickerOption } from '@/components/ui/picker';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AUTHORIZATION_KINDS,
  type AuthorizationKind,
} from '@/lib/setup/answers';

/** A row as the form holds it; `place` is '' until picked, `key` keeps the row stable. */
export type AuthorizationRow = {
  key: number;
  kind: AuthorizationKind;
  place: string;
};

const KIND_LABELS: Record<AuthorizationKind, string> = {
  citizenship: 'Citizenship',
  residency: 'Residency',
  'work-permit': 'Work permit',
  clearance: 'Security clearance',
};
const KIND_ITEMS = AUTHORIZATION_KINDS.map((value) => ({
  value,
  label: KIND_LABELS[value],
}));

type Props = {
  rows: AuthorizationRow[];
  /** Countries and regions. */
  places: PickerOption[];
  /** Form errors by path ("authorizations.1", "authorizations.1.place"). */
  errors: Record<string, string>;
  onChange: (rows: AuthorizationRow[]) => void;
};

/** Work authorization rows: a kind Select, a place Picker and a remove button. Stacks below `sm`. */
export function AuthorizationRows({ rows, places, errors, onChange }: Props) {
  const update = (key: number, patch: Partial<AuthorizationRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const nextKey = rows.reduce((max, r) => Math.max(max, r.key), 0) + 1;

  return (
    <div className="flex flex-col gap-3">
      {rows.map((row, i) => {
        const error =
          errors[`authorizations.${i}.place`] ?? errors[`authorizations.${i}`];
        return (
          <div
            key={row.key}
            className="flex flex-col gap-2 sm:flex-row sm:items-start"
          >
            <Select
              items={KIND_ITEMS}
              value={row.kind}
              onValueChange={(kind) =>
                kind && update(row.key, { kind: kind as AuthorizationKind })
              }
            >
              <SelectTrigger aria-label="Kind" className="w-full sm:w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KIND_ITEMS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Field invalid={Boolean(error)} className="sm:flex-1">
              <Picker
                options={places}
                value={row.place || null}
                onValueChange={(place) =>
                  update(row.key, { place: place ?? '' })
                }
                placeholder="Country or region"
                emptyText="No place found"
                aria-label="Place"
              />
              <FieldError>{error}</FieldError>
            </Field>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Remove authorization"
              onClick={() => onChange(rows.filter((r) => r.key !== row.key))}
            >
              <XIcon />
            </Button>
          </div>
        );
      })}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() =>
          onChange([...rows, { key: nextKey, kind: 'citizenship', place: '' }])
        }
      >
        <PlusIcon />
        {rows.length === 0 ? 'Add authorization' : 'Add another'}
      </Button>
    </div>
  );
}
