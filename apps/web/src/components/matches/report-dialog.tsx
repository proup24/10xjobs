'use client';

import { useId, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { ReportField } from '@/lib/matches/report';
import type { SaveResult } from '@/lib/setup/save-result';

export type Report = (r: {
  jobId: string;
  field: ReportField;
  proposedValue: string;
  note?: string;
}) => Promise<SaveResult>;

const REPORT_FIELD_OPTIONS: { value: ReportField; label: string }[] = [
  { value: 'role', label: 'Role' },
  { value: 'seniority', label: 'Seniority' },
  { value: 'arrangement', label: 'Arrangement' },
  { value: 'places', label: 'Places' },
  { value: 'contractType', label: 'Contract type' },
  { value: 'engagement', label: 'Engagement' },
  { value: 'salary', label: 'Salary' },
  { value: 'yearsRequired', label: 'Years required' },
  { value: 'techStack', label: 'Tech stack' },
  { value: 'requiredLanguages', label: 'Required languages' },
  { value: 'workAuthorization', label: 'Work authorization' },
];

const FAILED_TEXT = "Couldn't send your report. Try again.";

/**
 * "Report a mismatch": a dialog asking which fact is wrong and what it should
 * say. The facts list uses it without a field (the user picks one); the review
 * box passes the field it is about, which pre-picks the select.
 */
export function ReportDialog({
  jobId,
  field,
  label,
  onReport,
}: {
  jobId: string;
  /** Pre-picks the select; omitted on the facts-list link. */
  field?: ReportField;
  /** Fact name for the trigger's aria-label; used only with `field`. */
  label?: string;
  onReport: Report;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [proposed, setProposed] = useState('');
  const [note, setNote] = useState('');
  const [chosen, setChosen] = useState<ReportField | null>(field ?? null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [valueError, setValueError] = useState<string | null>(null);
  const id = useId();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pending) return;
    const missingField = chosen === null;
    const missingValue = proposed.trim() === '';
    setFieldError(missingField ? 'Choose a field.' : null);
    setValueError(missingValue ? 'Enter what it should say.' : null);
    if (chosen === null || missingValue) return;
    setPending(true);
    let result: SaveResult;
    try {
      result = await onReport({
        jobId,
        field: chosen,
        proposedValue: proposed,
        ...(note.trim() ? { note } : {}),
      });
    } catch {
      result = { status: 'failed' };
    } finally {
      setPending(false);
    }
    if (result.status === 'saved') {
      toast.success('Thanks, reported');
      setOpen(false);
      setChosen(field ?? null);
      setProposed('');
      setNote('');
      return;
    }
    if (result.status === 'invalid') {
      const { field: fieldMsg, proposedValue: valueMsg, _form } = result.errors;
      setFieldError(fieldMsg ?? null);
      setValueError(valueMsg ?? _form ?? (fieldMsg ? null : FAILED_TEXT));
      return;
    }
    toast.error(FAILED_TEXT);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) setOpen(next);
      }}
    >
      {/* With a field, the name carries it: two triggers share the visible text. */}
      <DialogTrigger
        render={<Button variant="link" size="xs" />}
        aria-label={
          field && label ? `Report a mismatch on ${label}` : undefined
        }
      >
        Report a mismatch
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Report a mismatch</DialogTitle>
            <DialogDescription>
              Tell us what this should say. Your report is logged for review.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field invalid={fieldError !== null} required>
              <FieldLabel htmlFor={`${id}-field`}>Field</FieldLabel>
              <Select
                items={REPORT_FIELD_OPTIONS}
                value={chosen}
                onValueChange={setChosen}
              >
                <SelectTrigger
                  id={`${id}-field`}
                  aria-label="Field"
                  className="w-full text-base md:text-sm"
                >
                  <SelectValue placeholder="Choose a field" />
                </SelectTrigger>
                <SelectContent>
                  {REPORT_FIELD_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError>{fieldError}</FieldError>
            </Field>
            <Field invalid={valueError !== null} required>
              <FieldLabel htmlFor={`${id}-value`}>
                What it should say
              </FieldLabel>
              <Input
                id={`${id}-value`}
                className="text-base md:text-sm"
                maxLength={200}
                value={proposed}
                onChange={(e) => setProposed(e.target.value)}
              />
              <FieldError>{valueError}</FieldError>
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-note`}>Note (optional)</FieldLabel>
              <Textarea
                id={`${id}-note`}
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" loading={pending}>
              Send report
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
