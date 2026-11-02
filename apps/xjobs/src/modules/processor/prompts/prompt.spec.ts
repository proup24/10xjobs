import { describe, expect, it } from 'vitest';
import { buildDecisionQuestions } from '../pipeline/questions';
import { seedOptions } from '../pipeline/options.testing';
import { promptHash, systemPrompt } from './prompt';

describe('promptHash', () => {
  const options = seedOptions();

  it('ignores option changes', () => {
    const a = promptHash(buildDecisionQuestions(options));
    const b = promptHash(
      buildDecisionQuestions({
        ...options,
        seniorities: [...options.seniorities, 'fellow'],
      }),
    );
    expect(a).toBe(b);
  });

  it('changes when an instruction changes', () => {
    const qs = buildDecisionQuestions(options);
    const a = promptHash(qs);
    qs[0] = { ...qs[0], instructions: qs[0].instructions + ' Changed.' };
    expect(promptHash(qs)).not.toBe(a);
  });
});

describe('systemPrompt', () => {
  const text = systemPrompt();

  it('holds no personal content or placeholders', () => {
    expect(text).not.toMatch(/^#+\s*Preferences/im);
    for (const bad of ['Morocco', 'criteria.json', '{{', 'batch file'])
      expect(text).not.toContain(bad);
  });

  it('explains fromListing and the fallback answers', () => {
    expect(text).toContain('fromListing');
    expect(text).toContain('fallback');
    expect(text).toContain('verbatim');
  });
});
