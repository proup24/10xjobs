import { describe, expect, it } from 'vitest';
import type { JobForProcessing } from '../models/types';
import { DESCRIPTION_CAP_BYTES, buildPostingInput, inputHash } from './input';

const evidence = {
  location: 'Berlin',
  contractType: 'Full-time',
  experienceLevel: null,
  salary: null,
};

function job(over: Partial<JobForProcessing> = {}): JobForProcessing {
  return {
    id: 'j1',
    closed: false,
    title: 'Engineer',
    companyName: 'Acme',
    descriptionText: 'Hello',
    evidence,
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

  it('changes when the evidence changes', () => {
    const a = buildPostingInput(job());
    const b = buildPostingInput(
      job({ evidence: { ...evidence, contractType: 'Contract' } }),
    );
    expect(inputHash(a)).not.toBe(inputHash(b));
  });
});
