'use client';

import { XIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError } from '@/components/ui/field';
import { Picker, type PickerOption } from '@/components/ui/picker';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  ARRANGEMENTS,
  placeKey,
  type ArrangementKey,
  type Place,
  type PlaceRow,
} from '@/lib/setup/answers';

/** A place the search offers; `value` is its `placeKey`. */
export type PlaceOption = PickerOption & { place: Place; kind: string | null };

const ARRANGEMENT_LABELS: Record<ArrangementKey, string> = {
  remote: 'Remote',
  hybrid: 'Hybrid',
  onsite: 'On-site',
};

const COVERED_HINT = 'Worldwide remote already covers remote here.';

const kindOption = (
  place: Place,
  kind: string,
  o: PickerOption,
): PlaceOption => ({
  ...o,
  value: placeKey(place),
  detail: kind,
  kind,
  place,
});

/** Worldwide first, then regions (no `GLOBAL`), countries and cities, each tagged with its kind. */
export function placeOptions(lists: {
  regions: PickerOption[];
  countries: PickerOption[];
  cities: PickerOption[];
}): PlaceOption[] {
  return [
    {
      value: 'worldwide',
      label: 'Worldwide',
      keywords: ['Anywhere', 'Global'],
      detail: 'Remote only',
      kind: null,
      place: { kind: 'worldwide' },
    },
    ...lists.regions
      .filter((r) => r.value !== 'GLOBAL')
      .map((r) => kindOption({ kind: 'region', code: r.value }, 'Region', r)),
    ...lists.countries.map((c) =>
      kindOption({ kind: 'country', code: c.value }, 'Country', c),
    ),
    ...lists.cities.map((c) =>
      kindOption({ kind: 'city', id: c.value }, 'City', c),
    ),
  ];
}

type Props = {
  value: PlaceRow[];
  onChange: (value: PlaceRow[]) => void;
  /** From `placeOptions`. */
  options: PlaceOption[];
  /** Form errors by path ("places", "places.1", "places.1.hybrid"). */
  errors?: Record<string, string>;
};

/**
 * The place search and one row per picked place: kind badge, label, Remote / Hybrid /
 * On-site toggles and a remove button. Worldwide is remote only. Stacks below `sm`.
 */
export function PlaceRows({ value, onChange, options, errors = {} }: Props) {
  const byKey = new Map(options.map((o) => [o.value, o]));
  const taken = new Set(value.map((r) => placeKey(r.place)));
  const choices = options.filter((o) => !taken.has(o.value));
  const worldwideRemote = value.some(
    (r) => r.place.kind === 'worldwide' && r.remote,
  );

  function add(key: string | null) {
    const option = key === null ? undefined : byKey.get(key);
    if (!option) return;
    const worldwide = option.place.kind === 'worldwide';
    onChange([
      ...value,
      { place: option.place, remote: worldwide, hybrid: false, onsite: false },
    ]);
  }

  return (
    <div className="flex flex-col gap-3">
      <Field invalid={Boolean(errors.places)} required>
        <Picker
          aria-label="Add a place"
          options={choices}
          value={null}
          onValueChange={add}
          placeholder="Search a region, country or city"
          emptyText="No place found"
          aria-invalid={errors.places ? true : undefined}
        />
        <FieldError>{errors.places}</FieldError>
      </Field>
      {value.map((row, i) => {
        const key = placeKey(row.place);
        const option = byKey.get(key);
        const label =
          option?.label ??
          (row.place.kind === 'city'
            ? row.place.id
            : row.place.kind === 'worldwide'
              ? 'Worldwide'
              : row.place.code);
        const kind = option ? option.kind : null;
        const worldwide = row.place.kind === 'worldwide';
        const error =
          errors[`places.${i}`] ??
          errors[`places.${i}.place`] ??
          errors[`places.${i}.hybrid`] ??
          errors[`places.${i}.onsite`];
        const covered = !worldwide && row.remote && worldwideRemote;
        return (
          <Field key={key} invalid={Boolean(error)}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="flex min-w-0 items-center gap-2 sm:flex-1">
                {kind && <Badge variant="secondary">{kind}</Badge>}
                <span className="min-w-0 text-sm font-medium break-words">
                  {label}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <ToggleGroup
                  multiple
                  variant="outline"
                  size="sm"
                  aria-label={`${label} arrangements`}
                  value={ARRANGEMENTS.filter((a) => row[a])}
                  onValueChange={(next: string[]) =>
                    onChange(
                      value.map((r) =>
                        placeKey(r.place) === key
                          ? {
                              ...r,
                              remote: next.includes('remote'),
                              hybrid: !worldwide && next.includes('hybrid'),
                              onsite: !worldwide && next.includes('onsite'),
                            }
                          : r,
                      ),
                    )
                  }
                >
                  {ARRANGEMENTS.map((a) => (
                    <ToggleGroupItem
                      key={a}
                      value={a}
                      disabled={worldwide && a !== 'remote'}
                    >
                      {ARRANGEMENT_LABELS[a]}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${label}`}
                  onClick={() =>
                    onChange(value.filter((r) => placeKey(r.place) !== key))
                  }
                >
                  <XIcon />
                </Button>
              </div>
            </div>
            {covered && <FieldDescription>{COVERED_HINT}</FieldDescription>}
            <FieldError>{error}</FieldError>
          </Field>
        );
      })}
    </div>
  );
}
