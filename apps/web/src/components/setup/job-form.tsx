'use client';

import { useEffect, useId, useState } from 'react';
import { isSearchableTech } from '@xjobs/database/enums';
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
import { Input } from '@/components/ui/input';
import { Picker, type PickerOption } from '@/components/ui/picker';
import {
  jobSchema,
  type JobAnswers,
  type TechAnswer,
} from '@/lib/setup/answers';
import type { SaveResult } from '@/lib/setup/save';
import type { TechOption } from '@/lib/setup/value-lists';
import { issueErrors } from './form-errors';
import { LanguageRows } from './language-rows';
import type { StepStatus } from './step-status';
import { notifySaveFailed } from './step-frame';
import { TechRows } from './tech-rows';

const STACK_DESCRIPTION =
  "Add every tech you'd be happy to work with; jobs that need something not on this list are skipped.";
/** A newly added language's level until the user changes it. */
const DEFAULT_LEVEL = 'fluent';

const schema = jobSchema(isSearchableTech);

type Props = {
  /** Null until the step was saved once: nothing is preselected. */
  initial: JobAnswers | null;
  lists: {
    positions: PickerOption[];
    seniorities: PickerOption[];
    techs: TechOption[];
    languages: PickerOption[];
  };
  onSave: (input: unknown) => Promise<SaveResult>;
  onSaved: () => void;
  /** Reports the save state to whoever frames the form. */
  onStatusChange?: (status: StepStatus) => void;
  /** The `<form>` id, so a frame's submit button can target it. */
  formId: string;
};

/** Step 3: position, experience, seniorities, the tech stack and languages. */
export function JobForm({
  formId,
  initial,
  lists,
  onSave,
  onSaved,
  onStatusChange,
}: Props) {
  const ids = useId();
  const [position, setPosition] = useState<string | null>(
    initial?.position ?? null,
  );
  const [years, setYears] = useState(
    initial ? String(initial.yearsOfExperience) : '',
  );
  const [seniorities, setSeniorities] = useState<string[]>(
    initial?.seniorities ?? [],
  );
  const [techs, setTechs] = useState<TechAnswer[]>(initial?.techs ?? []);
  const [languages, setLanguages] = useState<JobAnswers['languages']>(
    initial?.languages ?? [],
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const formError = errors._form;
  useEffect(() => {
    onStatusChange?.({ pending, formError });
  }, [pending, formError, onStatusChange]);

  const techLabel = new Map(lists.techs.map((t) => [t.value, t.label]));
  const takenTechs = new Set(techs.map((t) => t.code));
  const techChoices = lists.techs.filter((t) => !takenTechs.has(t.value));
  const takenLanguages = new Set(languages.map((l) => l.lang));
  const languageChoices = lists.languages.filter(
    (l) => !takenLanguages.has(l.value),
  );

  const toggleSeniority = (code: string, checked: boolean) =>
    setSeniorities(
      checked
        ? lists.seniorities
            .map((s) => s.value)
            .filter((s) => s === code || seniorities.includes(s))
        : seniorities.filter((s) => s !== code),
    );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const answers = {
      position: position ?? '',
      yearsOfExperience: years.trim() === '' ? 0 : Number(years),
      seniorities,
      techs,
      languages,
    };
    const parsed = schema.safeParse(answers);
    const found = parsed.success ? {} : issueErrors(parsed.error);
    if (position === null) found.position = 'Pick a position';
    if (years.trim() === '') {
      found.yearsOfExperience = 'Enter your years of experience';
    }
    techs.forEach((tech, i) => {
      if (tech.rating === null) {
        found[`techs.${i}.rating`] =
          `Rate ${techLabel.get(tech.code) ?? tech.code}`;
      }
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
        <Field invalid={Boolean(errors.position)} required>
          <FieldLabel htmlFor={`${ids}-position`}>Position</FieldLabel>
          <Picker
            id={`${ids}-position`}
            options={lists.positions}
            value={position}
            onValueChange={setPosition}
            placeholder="Search positions"
            emptyText="No position found"
          />
          <FieldError>{errors.position}</FieldError>
        </Field>

        <Field invalid={Boolean(errors.yearsOfExperience)} required>
          <FieldLabel htmlFor={`${ids}-years`}>Years of experience</FieldLabel>
          <Input
            id={`${ids}-years`}
            type="number"
            inputMode="numeric"
            min={0}
            max={60}
            step={1}
            className="sm:w-32"
            value={years}
            onChange={(e) => setYears(e.target.value)}
          />
          <FieldError>{errors.yearsOfExperience}</FieldError>
        </Field>

        <FieldSet>
          <FieldLegend variant="label">Seniority</FieldLegend>
          <Field invalid={Boolean(errors.seniorities)} required>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:gap-x-6">
              {lists.seniorities.map((s) => (
                <Field key={s.value} orientation="horizontal">
                  <Checkbox
                    id={`${ids}-seniority-${s.value}`}
                    checked={seniorities.includes(s.value)}
                    onCheckedChange={(checked) =>
                      toggleSeniority(s.value, checked)
                    }
                  />
                  <FieldLabel htmlFor={`${ids}-seniority-${s.value}`}>
                    {s.label}
                  </FieldLabel>
                </Field>
              ))}
            </div>
            <FieldError>{errors.seniorities}</FieldError>
          </Field>
        </FieldSet>

        <FieldSet>
          <FieldLegend variant="label">Tech stack</FieldLegend>
          <FieldDescription>{STACK_DESCRIPTION}</FieldDescription>
          <Field invalid={Boolean(errors.techs)}>
            <Picker
              aria-label="Add a tech"
              options={techChoices}
              value={null}
              onValueChange={(code) =>
                code &&
                setTechs([...techs, { code, rating: null, starred: false }])
              }
              placeholder="Search techs"
              emptyText="No tech found"
            />
            <FieldError>{errors.techs}</FieldError>
          </Field>
          <TechRows
            value={techs}
            onChange={setTechs}
            options={lists.techs}
            errors={errors}
          />
        </FieldSet>

        <FieldSet>
          <FieldLegend variant="label">Languages</FieldLegend>
          <Field invalid={Boolean(errors.languages)} required>
            <Picker
              aria-label="Add a language"
              options={languageChoices}
              value={null}
              onValueChange={(lang) =>
                lang &&
                setLanguages([...languages, { lang, level: DEFAULT_LEVEL }])
              }
              placeholder="Search languages"
              emptyText="No language found"
            />
            <FieldError>{errors.languages}</FieldError>
          </Field>
          <LanguageRows
            value={languages}
            onChange={setLanguages}
            options={lists.languages}
            errors={errors}
          />
        </FieldSet>
      </FieldGroup>
    </form>
  );
}
