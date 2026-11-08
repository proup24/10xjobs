'use client';

import { useId, useRef, useState } from 'react';
import { FileText, Upload, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useFieldControl } from '@/components/ui/field';

type RejectReason = 'type' | 'size' | 'multiple';

type FileDropZoneProps = {
  accept: { mime: string; extension: string };
  maxBytes: number;
  value: File | null;
  onFileChange: (file: File | null) => void;
  onReject: (reason: RejectReason) => void;
  error?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  'aria-required'?: boolean;
};

/**
 * A file matches when its MIME type equals `accept.mime` or its name ends with
 * `accept.extension` (case-insensitive). Browsers often report an empty MIME
 * type, so the extension alone is enough; a `.pdf` name with another MIME type
 * is also accepted, because the MIME type from the OS is a guess, not a check.
 */
function matches(file: File, accept: FileDropZoneProps['accept']) {
  return (
    file.type === accept.mime ||
    file.name.toLowerCase().endsWith(accept.extension.toLowerCase())
  );
}

function FileDropZone({
  accept,
  maxBytes,
  value,
  onFileChange,
  onReject,
  error,
  disabled = false,
  className,
  ...ariaProps
}: FileDropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const errorId = useId();
  const control = useFieldControl({
    ...ariaProps,
    'aria-invalid': ariaProps['aria-invalid'] ?? (error ? true : undefined),
    'aria-describedby':
      [ariaProps['aria-describedby'], error ? errorId : undefined]
        .filter(Boolean)
        .join(' ') || undefined,
  });

  function receive(files: FileList | File[] | null | undefined) {
    if (disabled || !files || files.length === 0) return;
    if (files.length > 1) return onReject('multiple');
    const file = files[0];
    if (!matches(file, accept)) return onReject('type');
    if (file.size > maxBytes) return onReject('size');
    onFileChange(file);
  }

  return (
    <div data-slot="file-drop-zone" className={cn('grid gap-2', className)}>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="dashed"
          disabled={disabled}
          data-drag-over={dragOver ? 'true' : undefined}
          onClick={() => inputRef.current?.click()}
          onDragEnter={(e) => {
            e.preventDefault();
            if (!disabled) setDragOver(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            if (!disabled) setDragOver(true);
          }}
          onDragLeave={(e) => {
            // Moving onto a child fires dragleave on the zone; keep the style.
            if (e.currentTarget.contains(e.relatedTarget as Node | null))
              return;
            setDragOver(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            receive(e.dataTransfer?.files);
          }}
          className={cn(
            'h-auto min-h-20 flex-1 flex-col gap-1 border-input px-4 py-4 whitespace-normal data-[drag-over=true]:border-brand data-[drag-over=true]:bg-muted',
          )}
          {...control}
        >
          {value ? (
            <span className="flex items-center gap-2 break-all">
              <FileText aria-hidden="true" />
              <span>{value.name}</span>
            </span>
          ) : (
            <>
              <span className="flex items-center gap-2">
                <Upload aria-hidden="true" />
                <span>Choose a file or drop it here</span>
              </span>
            </>
          )}
        </Button>
        {value && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Remove file"
            disabled={disabled}
            onClick={() => onFileChange(null)}
          >
            <X />
          </Button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        hidden
        tabIndex={-1}
        accept={`${accept.mime},${accept.extension}`}
        disabled={disabled}
        onChange={(e) => {
          const files = e.target.files;
          receive(files);
          // Reset so picking the same file again still fires onChange.
          e.target.value = '';
        }}
      />
      {error && (
        <p id={errorId} role="alert" className="text-sm text-destructive-text">
          {error}
        </p>
      )}
    </div>
  );
}

export { FileDropZone };
export type { FileDropZoneProps, RejectReason };
