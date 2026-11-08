// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { checkPdf } from './pdf';

function pdfOf(size: number): Uint8Array {
  const b = new Uint8Array(size);
  b.set(new TextEncoder().encode('%PDF-'));
  return b;
}

describe('checkPdf', () => {
  it('passes %PDF- bytes with their SHA-256', () => {
    const bytes = new TextEncoder().encode('%PDF-1.7 hello');
    const sha = createHash('sha256').update(bytes).digest('hex');
    expect(checkPdf(bytes)).toEqual({ ok: true, sha256: sha });
    expect(sha).toHaveLength(64);
  });

  it('rejects 4 bytes of %PDF', () => {
    expect(checkPdf(new TextEncoder().encode('%PDF'))).toEqual({
      ok: false,
      reason: 'not-pdf',
    });
  });

  it('rejects html', () => {
    expect(checkPdf(new TextEncoder().encode('<html>'))).toEqual({
      ok: false,
      reason: 'not-pdf',
    });
  });

  it('rejects 5,242,881 bytes as too-large', () => {
    expect(checkPdf(pdfOf(5_242_881))).toEqual({
      ok: false,
      reason: 'too-large',
    });
  });

  it('accepts exactly 5,242,880 bytes', () => {
    expect(checkPdf(pdfOf(5_242_880)).ok).toBe(true);
  });
});
