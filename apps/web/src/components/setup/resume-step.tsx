'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription } from '@/components/ui/field';
import {
  FileDropZone,
  type RejectReason,
} from '@/components/ui/file-drop-zone';
import { confirmResumeAction } from '@/lib/resume/actions';
import { uploadResume } from '@/lib/resume/browser';
import type { ConfirmResult } from '@/lib/resume/confirm';
import { MAX_RESUME_BYTES } from '@/lib/resume/key';
import { formatFileSize } from '@/lib/setup/labels';
import { SETUP_STEPS, stepPath } from '@/lib/setup/steps';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { StepFrame, notifySaveFailed } from './step-frame';

const FORM_ID = 'resume-form';
const ACCEPT = { mime: 'application/pdf', extension: '.pdf' };

const REJECT_MESSAGES: Record<RejectReason, string> = {
  type: 'Upload a PDF',
  size: 'PDFs up to 5 MB',
  multiple: 'Upload one file',
};

/** Invalid confirm results the user can fix; `bad-key` is ours, so it toasts. */
const INVALID_MESSAGES: Partial<Record<string, string>> = {
  'not-pdf': "This file isn't a PDF",
  'too-large': 'PDFs up to 5 MB',
};

type Resume = { filename: string; sizeBytes: number };

type Props = {
  profileId: string;
  userId: string;
  current: Resume | null;
  /** Defaults to going on to the review. */
  onSaved?: () => void;
};

/**
 * Step 5: upload a PDF to the profile (upload, then confirm on the server). Picking a
 * file uploads it at once; Continue stays disabled until the profile has a resume.
 */
export function ResumeStep({ profileId, userId, current, onSaved }: Props) {
  const router = useRouter();
  const [resume, setResume] = useState<Resume | null>(current);
  const [replacing, setReplacing] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string>();
  const uploading = file !== null;

  async function upload(picked: File) {
    setFile(picked);
    setError(undefined);
    let result: ConfirmResult;
    try {
      result = await uploadResume(
        createSupabaseBrowserClient(),
        userId,
        profileId,
        picked,
        confirmResumeAction,
      );
    } catch {
      result = { status: 'failed' };
    }
    setFile(null);
    if (result.status === 'saved') {
      setResume({
        filename: result.resume.filename,
        sizeBytes: result.resume.sizeBytes,
      });
      setReplacing(false);
      return;
    }
    const message =
      result.status === 'invalid' ? INVALID_MESSAGES[result.reason] : undefined;
    if (message) setError(message);
    else notifySaveFailed();
  }

  const showZone = resume === null || replacing;

  return (
    <StepFrame
      step="resume"
      title={SETUP_STEPS[4].label}
      pending={false}
      formId={FORM_ID}
      submitDisabled={resume === null || uploading}
    >
      <form
        id={FORM_ID}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (resume === null || uploading) return;
          if (onSaved) onSaved();
          else router.push(stepPath('review'));
        }}
      >
        {showZone ? (
          <Field invalid={Boolean(error)} required>
            <FileDropZone
              accept={ACCEPT}
              maxBytes={MAX_RESUME_BYTES}
              value={file}
              disabled={uploading}
              error={error}
              onFileChange={(f) => {
                if (f) void upload(f);
              }}
              onReject={(reason) => setError(REJECT_MESSAGES[reason])}
            />
            <FieldDescription>A PDF, up to 5 MB.</FieldDescription>
            {uploading && (
              <p role="status" className="text-sm text-muted-foreground">
                Uploading…
              </p>
            )}
            {replacing && !uploading && (
              <div>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setReplacing(false);
                    setError(undefined);
                  }}
                >
                  Keep the current resume
                </Button>
              </div>
            )}
          </Field>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex min-w-0 items-center gap-2">
              <FileText aria-hidden="true" />
              <span className="min-w-0 font-medium break-all">
                {resume.filename}
              </span>
              <span className="shrink-0 text-muted-foreground">
                {formatFileSize(resume.sizeBytes)}
              </span>
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={() => setReplacing(true)}
            >
              Replace
            </Button>
          </div>
        )}
      </form>
    </StepFrame>
  );
}
