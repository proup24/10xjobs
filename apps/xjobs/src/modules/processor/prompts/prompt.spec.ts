import { describe, expect, it } from 'vitest';
import { seedOptions } from '../rules/options.testing';
import { modelOutputSchema } from '../schema';
import { promptHash, systemPrompt } from './prompt';
import { SYSTEM_PROMPT } from './system.prompt';

describe('promptHash', () => {
  it('is stable and follows the system prompt', () => {
    expect(promptHash()).toBe(promptHash());
    expect(promptHash()).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('systemPrompt', () => {
  const text = systemPrompt();

  it('holds no personal content or placeholders', () => {
    expect(text).not.toMatch(/^#+\s*Preferences/im);
    for (const bad of ['Morocco', 'criteria.json', '{{', 'batch file'])
      expect(text).not.toContain(bad);
  });

  it('explains verbatim quotes', () => {
    expect(text).toContain('verbatim');
  });

  it('never mentions the listing', () => {
    expect(SYSTEM_PROMPT).not.toMatch(/listing/i);
    expect(SYSTEM_PROMPT).not.toMatch(/fromListing/);
    expect(SYSTEM_PROMPT).not.toMatch(/company name/i);
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
