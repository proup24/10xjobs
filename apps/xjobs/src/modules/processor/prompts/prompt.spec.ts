import { describe, expect, it } from 'vitest';
import { buildVerificationQuestions } from '../rules/questions';
import { seedOptions } from '../rules/options.testing';
import { modelOutputSchema } from '../schema';
import { promptHash, systemPrompt } from './prompt';

describe('promptHash', () => {
  const options = seedOptions();

  it('ignores option changes', () => {
    const a = promptHash(buildVerificationQuestions(options));
    const b = promptHash(
      buildVerificationQuestions({
        ...options,
        seniorities: [...options.seniorities, 'fellow'],
      }),
    );
    expect(a).toBe(b);
  });

  it('changes when a junk flag is added', () => {
    const a = promptHash(buildVerificationQuestions(options));
    const b = promptHash(
      buildVerificationQuestions({
        ...options,
        junkFlags: [...options.junkFlags, 'new_flag'],
      }),
    );
    expect(b).not.toBe(a);
  });

  it('changes when an instruction changes', () => {
    const qs = buildVerificationQuestions(options);
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

  it('explains fromListing and verbatim quotes', () => {
    expect(text).toContain('fromListing');
    expect(text).toContain('verbatim');
  });

  it('describes no fallback answers: the generator answers every field', () => {
    expect(text).not.toMatch(/fallback/i);
  });

  it('gives must-have alternatives their own example, not the main one', () => {
    const must = text.slice(text.indexOf('`kind: "must"`'));
    expect(must).toContain('"PostgreSQL or MySQL"');
    expect(must.slice(0, must.indexOf('### `groups`'))).not.toContain(
      'Python, TypeScript or Go',
    );
  });
});

describe('systemPrompt field paths', () => {
  const text = systemPrompt();

  it('mentions every top-level key of the model output', () => {
    const shape = modelOutputSchema(seedOptions()).shape;
    for (const key of Object.keys(shape)) expect(text).toContain(key);
  });

  it('mentions the nested names', () => {
    for (const name of [
      'requirements',
      'technology',
      'importance',
      'domain',
      'groups',
      'lang',
    ])
      expect(text).toContain(name);
  });
});
