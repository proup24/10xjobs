'use client';

import { useEffect, useId, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field';
import { MultiPicker, type PickerOption } from '@/components/ui/picker';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  termsSchema,
  type PlaceRow,
  type TermsAnswers,
} from '@/lib/setup/answers';
import { NOTICE_OPTIONS, timezonePrefill } from '@/lib/setup/options';
import type { SaveResult } from '@/lib/setup/save';
import { issueErrors } from './form-errors';
import { useDirty } from './use-dirty';
import { PlaceRows, placeOptions } from './place-rows';
import { SalaryFields, type SalaryDraft } from './salary-fields';
import type { StepStatus } from './step-status';
import { notifySaveFailed } from './step-frame';
import { TimezoneFields, type TimezoneValue } from './timezone-fields';

/** The lead of a form-level refusal; the database message follows on its own line. */
const CREATE_ERROR =
  "We couldn't create your profile from these answers. Check them and try again.";
const SAVE_ERROR = "We couldn't save these answers. Check them and try again.";

/** One plain line per engagement; an unknown code gets none. */
const ENGAGEMENT_HINTS: Record<string, string> = {
  employee: 'On the company’s payroll, with its benefits.',
  contractor: 'You invoice the company directly.',
  eor: 'Employed by a local partner that hires for the company.',
  agency: 'Placed and paid by a staffing agency.',
  per_task: 'Paid per task or project, as gig work.',
};

const NOTICE_ITEMS = NOTICE_OPTIONS.map((o) => ({
  value: String(o.days),
  label: o.label,
}));

// The browser's UTC offset, read on the client only: the server renders null, so
// hydration matches and the prefill appears right after.
const noSubscribe = () => () => undefined;
const browserOffset = () => -new Date().getTimezoneOffset();
const serverOffset = () => null;

type Props = {
  /** Null until the step was saved once: nothing is preselected but the time zone. */
  initial: TermsAnswers | null;
  lists: {
    regions: PickerOption[];
    countries: PickerOption[];
    cities: PickerOption[];
    contractTypes: PickerOption[];
    engagements: PickerOption[];
    currencies: PickerOption[];
  };
  /** True when the profile already exists: Continue edits it instead of creating it. */
  hasProfile: boolean;
  onSave: (input: unknown) => Promise<SaveResult>;
  onSaved: () => void;
  /** Reports the save state to whoever frames the form. */
  onStatusChange?: (status: StepStatus) => void;
  /** The `<form>` id, so a frame's submit button can target it. */
  formId: string;
  /** Reports whether the form has unsaved edits. Pass a stable callback. */
  onDirtyChange?: (dirty: boolean) => void;
};

function CheckGroup({
  legend,
  selectAllLabel,
  options,
  value,
  onChange,
  hints,
  error,
}: {
  legend: string;
  selectAllLabel: string;
  options: PickerOption[];
  value: string[];
  onChange: (value: string[]) => void;
  hints?: Record<string, string>;
  error?: string;
}) {
  const ids = useId();
  // Each checkbox is its own Field (label, hint), so the group's state is wired by hand.
  const errorId = `${ids}-error`;
  const toggle = (code: string, checked: boolean) =>
    onChange(
      checked
        ? options
            .map((o) => o.value)
            .filter((c) => c === code || value.includes(c))
        : value.filter((c) => c !== code),
    );
  return (
    <FieldSet>
      <FieldLegend variant="label" required>
        {legend}
      </FieldLegend>
      <Button
        type="button"
        variant="link"
        size="sm"
        className="h-auto self-start px-0"
        aria-label={selectAllLabel}
        onClick={() => onChange(options.map((o) => o.value))}
      >
        Select all
      </Button>
      <Field invalid={Boolean(error)} required>
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:gap-x-6">
          {options.map((o) => {
            const hint = hints?.[o.value];
            return (
              <Field key={o.value} orientation="horizontal">
                <Checkbox
                  id={`${ids}-${o.value}`}
                  checked={value.includes(o.value)}
                  onCheckedChange={(checked) => toggle(o.value, checked)}
                  aria-invalid={error ? true : undefined}
                  aria-required
                  aria-describedby={error ? errorId : undefined}
                />
                {hint ? (
                  <FieldContent>
                    <FieldLabel htmlFor={`${ids}-${o.value}`}>
                      {o.label}
                    </FieldLabel>
                    <FieldDescription>{hint}</FieldDescription>
                  </FieldContent>
                ) : (
                  <FieldLabel htmlFor={`${ids}-${o.value}`}>
                    {o.label}
                  </FieldLabel>
                )}
              </Field>
            );
          })}
        </div>
        <FieldError id={errorId}>{error}</FieldError>
      </Field>
    </FieldSet>
  );
}

const toSalaryDraft = (salary: TermsAnswers['salary']): SalaryDraft =>
  salary && {
    min: String(salary.min),
    currency: salary.currency,
    period: salary.period,
  };

/** Step 4: places and arrangements, time zone, contract types, engagements, notice, salary, currencies. */
export function TermsForm({
  formId,
  initial,
  lists,
  hasProfile,
  onSave,
  onSaved,
  onStatusChange,
  onDirtyChange,
}: Props) {
  const ids = useId();
  const [places, setPlaces] = useState<PlaceRow[]>(initial?.places ?? []);
  const [timezone, setTimezone] = useState<TimezoneValue | null>(
    initial && {
      current: initial.timezoneCurrent,
      min: initial.timezoneMin,
      max: initial.timezoneMax,
    },
  );
  const [contractTypes, setContractTypes] = useState<string[]>(
    initial?.contractTypes ?? [],
  );
  const [engagements, setEngagements] = useState<string[]>(
    initial?.engagements ?? [],
  );
  const [notice, setNotice] = useState<number | null>(
    initial?.noticePeriodDays ?? null,
  );
  const [salary, setSalary] = useState<SalaryDraft>(
    toSalaryDraft(initial?.salary ?? null),
  );
  const [anyCurrency, setAnyCurrency] = useState(
    initial?.acceptsAnyCurrency ?? true,
  );
  const [currencies, setCurrencies] = useState<string[]>(
    initial?.acceptedCurrencies ?? [],
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const formError = errors._form;
  useEffect(() => {
    onStatusChange?.({ pending, formError });
  }, [pending, formError, onStatusChange]);
  // The raw time zone, not the shown one: the browser prefill is not an edit.
  const { dirty, markClean, snapshot } = useDirty({
    places,
    timezone,
    contractTypes,
    engagements,
    notice,
    salary,
    anyCurrency,
    currencies,
  });
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const offset = useSyncExternalStore(noSubscribe, browserOffset, serverOffset);
  const prefill = offset === null ? null : timezonePrefill(offset);
  const shownTimezone: TimezoneValue = timezone ?? {
    current: prefill?.current ?? null,
    min: prefill?.min ?? null,
    max: prefill?.max ?? null,
  };

  const options = placeOptions(lists);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const tz = shownTimezone;
    const answers = {
      places,
      timezoneCurrent: tz.current ?? Number.NaN,
      timezoneMin: tz.min ?? Number.NaN,
      timezoneMax: tz.max ?? Number.NaN,
      contractTypes,
      engagements,
      noticePeriodDays: notice ?? -1,
      salary: salary && {
        min: salary.min.trim() === '' ? 0 : Number(salary.min),
        currency: salary.currency ?? '',
        period: salary.period ?? 'year',
      },
      acceptsAnyCurrency: anyCurrency,
      acceptedCurrencies: anyCurrency ? [] : currencies,
    };
    const parsed = termsSchema.safeParse(answers);
    const found = parsed.success ? {} : issueErrors(parsed.error);
    if (tz.current === null) found.timezoneCurrent = 'Pick a UTC offset';
    if (tz.min === null) found.timezoneMin = 'Pick a UTC offset';
    if (tz.max === null) found.timezoneMax = 'Pick a UTC offset';
    if (salary) {
      if (salary.min.trim() === '') found['salary.min'] = 'Enter an amount';
      if (salary.currency === null)
        found['salary.currency'] = 'Pick a currency';
      if (salary.period === null) found['salary.period'] = 'Pick a period';
    }
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
      markClean(snapshot);
      onSaved();
    } else if (result.status === 'invalid') {
      const { _form, ...fields } = result.errors;
      setErrors(
        _form === undefined
          ? fields
          : {
              ...fields,
              _form: `${hasProfile ? SAVE_ERROR : CREATE_ERROR}\n${_form}`,
            },
      );
    } else {
      notifySaveFailed();
    }
  }

  return (
    <form id={formId} onSubmit={submit} noValidate>
      <FieldGroup>
        <FieldSet>
          <FieldLegend variant="label">Where you'd work</FieldLegend>
          <FieldDescription>
            Add each place, then pick remote, hybrid or on-site for it.
          </FieldDescription>
          <PlaceRows
            value={places}
            onChange={setPlaces}
            options={options}
            errors={errors}
          />
        </FieldSet>

        <TimezoneFields
          value={shownTimezone}
          onChange={setTimezone}
          errors={errors}
        />

        <CheckGroup
          legend="Contract types"
          selectAllLabel="Select all contract types"
          options={lists.contractTypes}
          value={contractTypes}
          onChange={setContractTypes}
          error={errors.contractTypes}
        />

        <CheckGroup
          legend="Hired as"
          selectAllLabel="Select all engagements"
          options={lists.engagements}
          value={engagements}
          onChange={setEngagements}
          hints={ENGAGEMENT_HINTS}
          error={errors.engagements}
        />

        <Field invalid={Boolean(errors.noticePeriodDays)} required>
          <FieldLabel htmlFor={`${ids}-notice`}>Notice period</FieldLabel>
          <Select
            items={NOTICE_ITEMS}
            value={notice === null ? null : String(notice)}
            onValueChange={(v) => v !== null && setNotice(Number(v))}
          >
            <SelectTrigger
              id={`${ids}-notice`}
              aria-label="Notice period"
              className="w-full sm:w-48"
            >
              <SelectValue placeholder="How soon you can start" />
            </SelectTrigger>
            <SelectContent>
              {NOTICE_ITEMS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError>{errors.noticePeriodDays}</FieldError>
        </Field>

        <SalaryFields
          value={salary}
          onChange={setSalary}
          currencies={lists.currencies}
          errors={errors}
        />

        <FieldSet>
          <FieldLegend variant="label">Accepted currencies</FieldLegend>
          <Field orientation="horizontal">
            <Switch
              id={`${ids}-any-currency`}
              checked={anyCurrency}
              onCheckedChange={setAnyCurrency}
            />
            <FieldLabel htmlFor={`${ids}-any-currency`}>
              Any currency
            </FieldLabel>
          </Field>
          {!anyCurrency && (
            <Field invalid={Boolean(errors.acceptedCurrencies)} required>
              <MultiPicker
                aria-label="Accepted currencies"
                options={lists.currencies}
                value={currencies}
                onValueChange={setCurrencies}
                placeholder="Add currencies"
                emptyText="No currency found"
                aria-invalid={errors.acceptedCurrencies ? true : undefined}
              />
              <FieldError>{errors.acceptedCurrencies}</FieldError>
            </Field>
          )}
        </FieldSet>
      </FieldGroup>
    </form>
  );
}
