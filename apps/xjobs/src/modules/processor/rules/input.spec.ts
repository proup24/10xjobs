import { describe, expect, it } from 'vitest';
import type { JobForProcessing } from '../models/types';
import { DESCRIPTION_CAP_BYTES, buildPostingInput, inputHash } from './input';

function job(over: Partial<JobForProcessing> = {}): JobForProcessing {
  return {
    id: 'j1',
    closed: false,
    title: 'Engineer',
    descriptionText: 'Hello',
    ...over,
  };
}

describe('buildPostingInput', () => {
  it('turns a null description into an empty string', () => {
    const input = buildPostingInput(job({ descriptionText: null }));
    expect(input.description).toBe('');
    expect(input.truncated).toBe(false);
    expect(input.jobId).toBe('j1');
  });

  it('cuts a long description at a paragraph boundary', () => {
    const paragraph = 'a'.repeat(998) + '\n\n';
    const text = paragraph.repeat(40);
    expect(Buffer.byteLength(text)).toBeGreaterThan(40_000 - 10);
    const input = buildPostingInput(job({ descriptionText: text }));
    expect(Buffer.byteLength(input.description)).toBeLessThanOrEqual(
      DESCRIPTION_CAP_BYTES,
    );
    expect(input.truncated).toBe(true);
    expect(text.startsWith(input.description)).toBe(true);
    expect(text.slice(input.description.length).startsWith('\n\n')).toBe(true);
  });

  it('hard-cuts when there is no paragraph break', () => {
    const input = buildPostingInput(
      job({ descriptionText: 'b'.repeat(40_000) }),
    );
    expect(Buffer.byteLength(input.description)).toBeLessThanOrEqual(
      DESCRIPTION_CAP_BYTES,
    );
    expect(input.truncated).toBe(true);
  });

  it('keeps the last paragraph when the cap falls on a boundary', () => {
    const text =
      'a'.repeat(DESCRIPTION_CAP_BYTES - 5) + '\n\n' + 'b'.repeat(500);
    // head of 30,000 bytes = 'a' * 29,995 + '\n\n' + 3 bytes; construct an exact boundary instead
    const exact = 'a'.repeat(DESCRIPTION_CAP_BYTES) + '\n\n' + 'b'.repeat(500);
    const input = buildPostingInput(job({ descriptionText: exact }));
    expect(input.description).toBe('a'.repeat(DESCRIPTION_CAP_BYTES));
    expect(input.truncated).toBe(true);
    expect(buildPostingInput(job({ descriptionText: text })).description).toBe(
      'a'.repeat(DESCRIPTION_CAP_BYTES - 5),
    );
  });

  it('never splits a multi-byte character', () => {
    for (const unit of ['é', '😀', 'a😀']) {
      const input = buildPostingInput(
        job({ descriptionText: unit.repeat(20_000) }),
      );
      expect(input.description).not.toContain('\uFFFD');
      expect(Buffer.byteLength(input.description)).toBeLessThanOrEqual(
        DESCRIPTION_CAP_BYTES,
      );
      expect(input.truncated).toBe(true);
    }
  });

  it('keeps a description under the cap whole', () => {
    const input = buildPostingInput(job({ descriptionText: 'x\n\ny' }));
    expect(input.description).toBe('x\n\ny');
    expect(input.truncated).toBe(false);
  });
});

describe('inputHash', () => {
  it('ignores jobId', () => {
    const a = buildPostingInput(job({ id: 'a' }));
    const b = buildPostingInput(job({ id: 'b' }));
    expect(inputHash(a)).toBe(inputHash(b));
  });

  it('ignores nothing but the title and description', () => {
    // Listing columns a stored job row carries are not part of the input.
    const listing = (over: Record<string, unknown>) =>
      job(over as Partial<JobForProcessing>);
    const a = buildPostingInput(
      listing({
        companyName: 'Acme',
        evidence: { location: 'Berlin', contractType: 'Full-time' },
      }),
    );
    const b = buildPostingInput(
      listing({
        companyName: 'Other',
        evidence: { location: 'Paris', contractType: 'Contract' },
      }),
    );
    expect(inputHash(a)).toBe(inputHash(b));
    expect(Object.keys(a).sort()).toEqual([
      'description',
      'jobId',
      'title',
      'truncated',
    ]);
  });

  it('changes when the title or description changes', () => {
    const a = buildPostingInput(job());
    expect(inputHash(buildPostingInput(job({ title: 'Other' })))).not.toBe(
      inputHash(a),
    );
    expect(
      inputHash(buildPostingInput(job({ descriptionText: 'Bye' }))),
    ).not.toBe(inputHash(a));
  });
});
