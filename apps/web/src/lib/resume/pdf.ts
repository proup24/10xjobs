import { createHash } from 'node:crypto';
import { MAX_RESUME_BYTES } from './key';

export type PdfCheck =
  | { ok: true; sha256: string }
  | { ok: false; reason: 'not-pdf' | 'too-large' };

const MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-

export function checkPdf(bytes: Uint8Array): PdfCheck {
  if (bytes.length > MAX_RESUME_BYTES)
    return { ok: false, reason: 'too-large' };
  if (bytes.length < MAGIC.length || MAGIC.some((b, i) => bytes[i] !== b)) {
    return { ok: false, reason: 'not-pdf' };
  }
  return { ok: true, sha256: createHash('sha256').update(bytes).digest('hex') };
}
