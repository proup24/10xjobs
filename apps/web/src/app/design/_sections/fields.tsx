'use client';

import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Block } from './block';

export function FieldsSection() {
  return (
    <section className="flex flex-col gap-6">
      <h2 className="text-title-3">Fields and errors</h2>
      <Block title="Label, control, description">
        <Field className="max-w-sm">
          <FieldLabel htmlFor="field-email">Email</FieldLabel>
          <Input id="field-email" type="email" placeholder="you@example.com" />
          <FieldDescription>We send a sign-in code here.</FieldDescription>
        </Field>
      </Block>
      <Block title="Required: marker on the label, aria-required on the control">
        <Field required className="max-w-sm">
          <FieldLabel htmlFor="field-name">Full name</FieldLabel>
          <Input id="field-name" />
        </Field>
      </Block>
      <Block title="Invalid: error linked to the control">
        <Field invalid className="max-w-sm">
          <FieldLabel htmlFor="field-email-bad">Email</FieldLabel>
          <Input
            id="field-email-bad"
            type="email"
            defaultValue="not-an-email"
          />
          <FieldDescription>We send a sign-in code here.</FieldDescription>
          <FieldError>Enter a valid email address.</FieldError>
        </Field>
      </Block>
      <Block title="Invalid textarea">
        <Field invalid className="max-w-sm">
          <FieldLabel htmlFor="field-notes">Notes</FieldLabel>
          <Textarea id="field-notes" defaultValue="x" />
          <FieldError>Write at least 20 characters.</FieldError>
        </Field>
      </Block>
    </section>
  );
}
