'use client';

import { useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field';
import { Picker, type PickerOption } from '@/components/ui/picker';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  eligibilitySchema,
  type EligibilityAnswers,
} from '@/lib/setup/answers';
import type { SaveResult } from '@/lib/setup/save';
import { AuthorizationRows, type AuthorizationRow } from './authorization-rows';
import { issueErrors } from './form-errors';
import type { StepStatus } from './step-status';
import { notifySaveFailed } from './step-frame';

const NONE_LABEL = "I don't hold any work authorization";

type Props = {
  /** Null until the step was saved once: nothing is preselected. */
  initial: EligibilityAnswers | null;
  lists: { countries: PickerOption[]; regions: PickerOption[] };
  onSave: (input: unknown) => Promise<SaveResult>;
  onSaved: () => void;
  /** Reports the save state to whoever frames the form. */
  onStatusChange?: (status: StepStatus) => void;
  /** The `<form>` id, so a frame's submit button can target it. */
  formId: string;
};

/** Step 2: residence, work authorizations (or none, deliberately) and sponsorship. */
export function EligibilityForm({
  formId,
  initial,
  lists,
  onSave,
  onSaved,
  onStatusChange,
}: Props) {
  const ids = useId();
  const [residence, setResidence] = useState<string | null>(
    initial?.residenceCountry ?? null,
  );
  const [sponsorship, setSponsorship] = useState<boolean | null>(
    initial?.acceptsSponsorship ?? null,
  );
  const [rows, setRows] = useState<AuthorizationRow[]>(
    (initial?.authorizations ?? []).map((a, i) => ({ key: i + 1, ...a })),
  );
  const [none, setNone] = useState(initial?.noneConfirmed ?? false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const formError = errors._form;
  useEffect(() => {
    onStatusChange?.({ pending, formError });
  }, [pending, formError, onStatusChange]);

  const places = [...lists.countries, ...lists.regions];
  const residenceLabel = lists.countries.find(
    (c) => c.value === residence,
  )?.label;
  const suggest =
    residence !== null &&
    !rows.some((r) => r.kind === 'residency' && r.place === residence);

  const changeRows = (next: AuthorizationRow[]) => {
    setRows(next);
    if (next.length > 0) setNone(false);
  };

  function addResidency() {
    if (residence === null) return;
    const key = rows.reduce((max, r) => Math.max(max, r.key), 0) + 1;
    changeRows([...rows, { key, kind: 'residency', place: residence }]);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const answers = {
      residenceCountry: residence ?? '',
      acceptsSponsorship: sponsorship ?? false,
      authorizations: rows.map(({ kind, place }) => ({ kind, place })),
      noneConfirmed: none,
    };
    const parsed = eligibilitySchema.safeParse(answers);
    const found = parsed.success ? {} : issueErrors(parsed.error);
    if (residence === null) {
      found.residenceCountry = 'Pick your country of residence';
    }
    if (sponsorship === null) found.acceptsSponsorship = 'Choose yes or no';
    rows.forEach((row, i) => {
      if (row.place === '') found[`authorizations.${i}.place`] = 'Pick a place';
    });
    if (!parsed.success || Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    setErrors({});
    setPending(true);
    let result: SaveResult;
    try {
      result = await onSave(parsed.data);
    } catch {
      result = { status: 'failed' };
    }
    setPending(false);
    if (result.status === 'saved') {
      onSaved();
    } else if (result.status === 'invalid') {
      setErrors(result.errors);
    } else {
      notifySaveFailed();
    }
  }

  return (
    <form id={formId} onSubmit={submit} noValidate>
      <FieldGroup>
        <Field invalid={Boolean(errors.residenceCountry)} required>
          <FieldLabel htmlFor={`${ids}-residence`}>
            Country of residence
          </FieldLabel>
          <Picker
            id={`${ids}-residence`}
            options={lists.countries}
            value={residence}
            onValueChange={setResidence}
            placeholder="Search countries"
            emptyText="No country found"
          />
          <FieldError>{errors.residenceCountry}</FieldError>
        </Field>

        <FieldSet>
          <FieldLegend variant="label">Work authorizations</FieldLegend>
          <FieldDescription>
            Where you can work without needing a visa from an employer.
          </FieldDescription>
          {suggest && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-auto self-start whitespace-normal"
              onClick={addResidency}
            >
              {`Add residency in ${residenceLabel ?? residence}?`}
            </Button>
          )}
          <AuthorizationRows
            rows={rows}
            places={places}
            errors={errors}
            onChange={changeRows}
          />
          <Field
            orientation="horizontal"
            invalid={Boolean(errors.noneConfirmed)}
          >
            <Checkbox
              id={`${ids}-none`}
              checked={none}
              disabled={rows.length > 0}
              onCheckedChange={setNone}
            />
            <FieldLabel htmlFor={`${ids}-none`}>{NONE_LABEL}</FieldLabel>
          </Field>
          <Field invalid={Boolean(errors.noneConfirmed)}>
            <FieldError>{errors.noneConfirmed}</FieldError>
          </Field>
        </FieldSet>

        <FieldSet>
          <FieldLegend variant="label" required>
            Would you take a job that sponsors your visa?
          </FieldLegend>
          <Field invalid={Boolean(errors.acceptsSponsorship)} required>
            <RadioGroup
              value={sponsorship === null ? '' : sponsorship ? 'yes' : 'no'}
              onValueChange={(v) => setSponsorship(v === 'yes')}
            >
              <Field orientation="horizontal">
                <RadioGroupItem id={`${ids}-yes`} value="yes" />
                <FieldLabel htmlFor={`${ids}-yes`}>Yes</FieldLabel>
              </Field>
              <Field orientation="horizontal">
                <RadioGroupItem id={`${ids}-no`} value="no" />
                <FieldLabel htmlFor={`${ids}-no`}>No</FieldLabel>
              </Field>
            </RadioGroup>
            <FieldError>{errors.acceptsSponsorship}</FieldError>
          </Field>
        </FieldSet>
      </FieldGroup>
    </form>
  );
}
