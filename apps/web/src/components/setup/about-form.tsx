'use client';

import { useEffect, useId, useState } from 'react';
import { PlusIcon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  aboutSchema,
  LINK_KINDS,
  type AboutAnswers,
} from '@/lib/setup/answers';
import { LINK_LABELS } from '@/lib/setup/labels';
import type { SaveResult } from '@/lib/setup/save';
import { issueErrors } from './form-errors';
import type { StepStatus } from './step-status';
import { notifySaveFailed } from './step-frame';

type LinkKind = (typeof LINK_KINDS)[number];
type LinkRow = { key: number; kind: LinkKind; value: string };

const LINK_ITEMS = LINK_KINDS.map((value) => ({
  value,
  label: LINK_LABELS[value],
}));

type Props = {
  email: string;
  initial: AboutAnswers;
  onSave: (input: unknown) => Promise<SaveResult>;
  onSaved: () => void;
  /** Reports the save state to whoever frames the form. */
  onStatusChange?: (status: StepStatus) => void;
  /** The `<form>` id, so a frame's submit button can target it. */
  formId: string;
};

/** Step 1: name, the account email (read-only) and optional contacts. */
export function AboutForm({
  formId,
  email,
  initial,
  onSave,
  onSaved,
  onStatusChange,
}: Props) {
  const ids = useId();
  const [name, setName] = useState(initial.name);
  const [phone, setPhone] = useState(initial.phone ?? '');
  const [linkedin, setLinkedin] = useState(initial.linkedin ?? '');
  const [links, setLinks] = useState<LinkRow[]>(
    initial.links.map((l, i) => ({ key: i + 1, ...l })),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const formError = errors._form;
  useEffect(() => {
    onStatusChange?.({ pending, formError });
  }, [pending, formError, onStatusChange]);

  const updateLink = (key: number, patch: Partial<LinkRow>) =>
    setLinks(links.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = aboutSchema.safeParse({
      name,
      phone: phone.trim() === '' ? null : phone,
      linkedin: linkedin.trim() === '' ? null : linkedin,
      links: links.map(({ kind, value }) => ({ kind, value })),
    });
    if (!parsed.success) {
      setErrors(issueErrors(parsed.error));
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

  const nextKey = links.reduce((max, l) => Math.max(max, l.key), 0) + 1;

  return (
    <form id={formId} onSubmit={submit} noValidate>
      <FieldGroup>
        <Field invalid={Boolean(errors.name)} required>
          <FieldLabel htmlFor={`${ids}-name`}>Name</FieldLabel>
          <Input
            id={`${ids}-name`}
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <FieldError>{errors.name}</FieldError>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${ids}-email`}>Email</FieldLabel>
          <Input id={`${ids}-email`} value={email} readOnly />
        </Field>
        <Field invalid={Boolean(errors.phone)}>
          <FieldLabel htmlFor={`${ids}-phone`}>Phone (optional)</FieldLabel>
          <Input
            id={`${ids}-phone`}
            type="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <FieldError>{errors.phone}</FieldError>
        </Field>
        <Field invalid={Boolean(errors.linkedin)}>
          <FieldLabel htmlFor={`${ids}-linkedin`}>
            LinkedIn (optional)
          </FieldLabel>
          <Input
            id={`${ids}-linkedin`}
            value={linkedin}
            onChange={(e) => setLinkedin(e.target.value)}
          />
          <FieldError>{errors.linkedin}</FieldError>
        </Field>
        <FieldSet>
          <FieldLegend variant="label">Links (optional)</FieldLegend>
          {links.map((link, i) => {
            const error = errors[`links.${i}.value`];
            return (
              <div
                key={link.key}
                className="flex flex-col gap-2 sm:flex-row sm:items-start"
              >
                <Select
                  items={LINK_ITEMS}
                  value={link.kind}
                  onValueChange={(kind) =>
                    kind && updateLink(link.key, { kind: kind as LinkKind })
                  }
                >
                  <SelectTrigger
                    aria-label="Link type"
                    className="w-full sm:w-40"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LINK_ITEMS.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Field invalid={Boolean(error)} className="sm:flex-1">
                  <Input
                    type="url"
                    aria-label="Link address"
                    placeholder="https://"
                    value={link.value}
                    onChange={(e) =>
                      updateLink(link.key, { value: e.target.value })
                    }
                  />
                  <FieldError>{error}</FieldError>
                </Field>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Remove link"
                  onClick={() =>
                    setLinks(links.filter((l) => l.key !== link.key))
                  }
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
              setLinks([...links, { key: nextKey, kind: 'github', value: '' }])
            }
          >
            <PlusIcon />
            Add a link
          </Button>
        </FieldSet>
      </FieldGroup>
    </form>
  );
}
