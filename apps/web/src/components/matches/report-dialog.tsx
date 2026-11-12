'use client';

import { useState } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import type { ReportField } from '@/lib/matches/report';
import type { SaveResult } from '@/lib/setup/save-result';

export type Report = (r: {
  jobId: string;
  field: ReportField;
  proposedValue: string;
  note?: string;
}) => Promise<SaveResult>;

const FAILED_TEXT = "Couldn't send your report. Try again.";

/** "Report a mismatch" on one fact: a dialog asking what the fact should say. */
export function ReportDialog({
  jobId,
  field,
  label,
  onReport,
}: {
  jobId: string;
  field: ReportField;
  /** The fact's name as shown, e.g. "Seniority". */
  label: string;
  onReport: Report;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [proposed, setProposed] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pending) return;
    if (proposed.trim() === '') {
      setError('Enter what it should say.');
      return;
    }
    setError(null);
    setPending(true);
    let result: SaveResult;
    try {
      result = await onReport({
        jobId,
        field,
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
      setProposed('');
      setNote('');
      return;
    }
    if (result.status === 'invalid') {
      setError(
        result.errors.proposedValue ?? result.errors._form ?? FAILED_TEXT,
      );
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
      <DialogTrigger render={<Button variant="link" size="xs" />}>
        Report a mismatch
        <span className="sr-only">{` on ${label}`}</span>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{`Report a mismatch: ${label}`}</DialogTitle>
            <DialogDescription>
              Tell us what this should say. Your report is logged for review.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field invalid={error !== null} required>
              <FieldLabel htmlFor={`report-${field}-value`}>
                What it should say
              </FieldLabel>
              <Input
                id={`report-${field}-value`}
                className="text-base md:text-sm"
                maxLength={200}
                value={proposed}
                onChange={(e) => setProposed(e.target.value)}
              />
              <FieldError>{error}</FieldError>
            </Field>
            <Field>
              <FieldLabel htmlFor={`report-${field}-note`}>
                Note (optional)
              </FieldLabel>
              <Textarea
                id={`report-${field}-note`}
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
