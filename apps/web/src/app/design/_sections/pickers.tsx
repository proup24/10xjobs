'use client';

import { useState } from 'react';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field';
import { MultiPicker, Picker, type PickerOption } from '@/components/ui/picker';
import { Block } from './block';
import { COUNTRIES } from './countries';

const TECHS: PickerOption[] = [
  { value: 'typescript', label: 'TypeScript', keywords: ['TS'] },
  { value: 'javascript', label: 'JavaScript', keywords: ['JS'] },
  { value: 'react', label: 'React' },
  { value: 'nextjs', label: 'Next.js', keywords: ['nextjs'] },
  { value: 'nestjs', label: 'NestJS' },
  { value: 'nodejs', label: 'Node.js', keywords: ['node'] },
  { value: 'postgres', label: 'PostgreSQL', keywords: ['Postgres', 'psql'] },
  { value: 'go', label: 'Go', keywords: ['golang'] },
  { value: 'rust', label: 'Rust' },
  { value: 'python', label: 'Python' },
  { value: 'kubernetes', label: 'Kubernetes', keywords: ['k8s'] },
];

export function PickersSection() {
  const [country, setCountry] = useState<string | null>(null);
  const [countries, setCountries] = useState<string[]>(['CH', 'DE']);
  const [techs, setTechs] = useState<string[]>([]);

  return (
    <section className="flex flex-col gap-6">
      <h2 className="text-title-3">Pickers</h2>
      <Block title="Picker: one value from 250 countries (try “usa”, “uk” or “cote”)">
        <Field className="w-full max-w-sm">
          <FieldLabel htmlFor="picker-country">Country</FieldLabel>
          <Picker
            id="picker-country"
            options={COUNTRIES}
            value={country}
            onValueChange={setCountry}
            placeholder="Search countries"
            emptyText="No country found"
          />
          <FieldDescription>
            Shows 50 matches at most; keep typing to narrow.
          </FieldDescription>
        </Field>
      </Block>
      <Block title="MultiPicker: chips, Backspace removes the last one">
        <Field className="w-full max-w-sm">
          <FieldLabel htmlFor="picker-countries">Countries</FieldLabel>
          <MultiPicker
            id="picker-countries"
            options={COUNTRIES}
            value={countries}
            onValueChange={setCountries}
            placeholder="Add countries"
            emptyText="No country found"
          />
        </Field>
      </Block>
      <Block title="Invalid and disabled">
        <Field invalid required className="w-full max-w-sm">
          <FieldLabel htmlFor="picker-techs">Techs</FieldLabel>
          <MultiPicker
            id="picker-techs"
            options={TECHS}
            value={techs}
            onValueChange={setTechs}
            placeholder="Add techs (try “k8s”)"
            emptyText="No tech found"
          />
          <FieldError>Pick at least one tech.</FieldError>
        </Field>
        <Field className="w-full max-w-sm">
          <FieldLabel htmlFor="picker-disabled">Country (disabled)</FieldLabel>
          <Picker
            id="picker-disabled"
            options={COUNTRIES}
            value="FR"
            onValueChange={() => undefined}
            placeholder="Search countries"
            emptyText="No country found"
            disabled
          />
        </Field>
      </Block>
    </section>
  );
}
