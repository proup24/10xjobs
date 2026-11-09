'use client';

import { useId, useState, useTransition } from 'react';
import { unstable_rethrow } from 'next/navigation';
import { startNewProfileAction } from '@/app/(app)/preferences/new/actions';
import { notifySaveFailed } from '@/components/setup/step-frame';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { NewProfileSource } from '@/lib/preferences/new-profile';
import { PROFILE_LIMIT_HINT } from '@/lib/preferences/profiles';

type Kind = NewProfileSource['kind'];

type Props = {
  /** The user's profiles, labelled as the nav labels them. */
  profiles: { id: string; label: string }[];
};

/**
 * The new profile's starting point: blank, or a copy of one of the user's profiles.
 * Nothing is preselected; Continue waits until the choice is complete. On success the
 * action redirects to the first step.
 */
export function StartChooser({ profiles }: Props) {
  const ids = useId();
  const [kind, setKind] = useState<Kind | null>(null);
  const [copyFrom, setCopyFrom] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [limit, setLimit] = useState(false);

  const source: NewProfileSource | null =
    kind === 'blank'
      ? { kind: 'blank' }
      : kind === 'copy' && copyFrom
        ? { kind: 'copy', profileId: copyFrom }
        : null;
  const items = profiles.map((p) => ({ value: p.id, label: p.label }));

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!source || pending) return;
    setLimit(false);
    // In a transition, so the action's redirect reaches Next's redirect boundary and
    // the button stays pending until the job step has loaded.
    startTransition(async () => {
      let result: 'limit' | 'failed';
      try {
        result = await startNewProfileAction(source);
      } catch (e) {
        // The redirect to the job step arrives as a rejection: let Next handle it.
        unstable_rethrow(e);
        result = 'failed';
      }
      if (result === 'limit') setLimit(true);
      else notifySaveFailed();
    });
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      <FieldGroup>
        <FieldSet>
          <FieldLegend id={`${ids}-legend`} variant="label" required>
            Start from
          </FieldLegend>
          <RadioGroup
            aria-labelledby={`${ids}-legend`}
            value={kind ?? ''}
            onValueChange={(v) => {
              const next = v as Kind;
              setKind(next);
              if (next === 'blank') setCopyFrom(null);
            }}
          >
            <Field orientation="horizontal">
              <RadioGroupItem id={`${ids}-blank`} value="blank" />
              <FieldLabel htmlFor={`${ids}-blank`}>Blank</FieldLabel>
            </Field>
            {profiles.length > 0 && (
              <Field orientation="horizontal">
                <RadioGroupItem id={`${ids}-copy`} value="copy" />
                <FieldLabel htmlFor={`${ids}-copy`}>
                  Copy from an existing profile
                </FieldLabel>
              </Field>
            )}
          </RadioGroup>
        </FieldSet>

        {kind === 'copy' && (
          <Field required>
            <FieldLabel htmlFor={`${ids}-profile`}>Profile to copy</FieldLabel>
            <Select items={items} value={copyFrom} onValueChange={setCopyFrom}>
              <SelectTrigger
                id={`${ids}-profile`}
                aria-label="Profile to copy"
                className="w-full sm:w-72"
              >
                <SelectValue placeholder="Pick a profile" />
              </SelectTrigger>
              <SelectContent>
                {items.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
      </FieldGroup>

      {limit && (
        <p role="alert" className="text-sm text-destructive">
          {PROFILE_LIMIT_HINT}
        </p>
      )}

      <div className="flex justify-end">
        <Button type="submit" loading={pending} disabled={!source}>
          Continue
        </Button>
      </div>
    </form>
  );
}
