'use client';

import { useEffect, useState } from 'react';
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
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { notifySaveFailed } from './step-frame';

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

export type Resume = { filename: string; sizeBytes: number };

type Props = {
  profileId: string;
  userId: string;
  current: Resume | null;
  /** Reports the resume and whether an upload is running, on mount and on every change. */
  onChange?: (state: { resume: Resume | null; uploading: boolean }) => void;
};

/**
 * Upload a PDF to the profile (upload, then confirm on the server). Picking a file
 * uploads it at once. Has no form or submit of its own, so it can sit anywhere.
 */
export function ResumeField({ profileId, userId, current, onChange }: Props) {
  const [resume, setResume] = useState<Resume | null>(current);
  const [replacing, setReplacing] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string>();
  const uploading = file !== null;

  useEffect(() => {
    onChange?.({ resume, uploading });
  }, [resume, uploading]);

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

  return showZone ? (
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
        <span className="min-w-0 font-medium break-all">{resume.filename}</span>
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
  );
}
