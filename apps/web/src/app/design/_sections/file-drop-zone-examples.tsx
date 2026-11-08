'use client';

import { useState } from 'react';
import { FileDropZone } from '@/components/ui/file-drop-zone';
import { Block } from './block';

const accept = { mime: 'application/pdf', extension: '.pdf' };
const MAX_BYTES = 5_242_880;

const reasons = {
  type: 'Only PDF files are accepted.',
  size: 'The file is larger than 5 MB.',
  multiple: 'Drop one file at a time.',
} as const;

export function FileDropZoneExamples() {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string>();
  const sample = new File(['x'], 'resume.pdf', { type: 'application/pdf' });
  return (
    <>
      <Block title="File drop zone: empty (try a drop or pick)">
        <FileDropZone
          className="w-full max-w-md"
          accept={accept}
          maxBytes={MAX_BYTES}
          value={file}
          error={error}
          onFileChange={(f) => {
            setFile(f);
            setError(undefined);
          }}
          onReject={(r) => setError(reasons[r])}
        />
      </Block>
      <Block title="File drop zone: with a file">
        <FileDropZone
          className="w-full max-w-md"
          accept={accept}
          maxBytes={MAX_BYTES}
          value={sample}
          onFileChange={() => undefined}
          onReject={() => undefined}
        />
      </Block>
      <Block title="File drop zone: error">
        <FileDropZone
          className="w-full max-w-md"
          accept={accept}
          maxBytes={MAX_BYTES}
          value={null}
          error={reasons.type}
          onFileChange={() => undefined}
          onReject={() => undefined}
        />
      </Block>
      <Block title="File drop zone: disabled">
        <FileDropZone
          className="w-full max-w-md"
          accept={accept}
          maxBytes={MAX_BYTES}
          value={null}
          disabled
          onFileChange={() => undefined}
          onReject={() => undefined}
        />
      </Block>
    </>
  );
}
