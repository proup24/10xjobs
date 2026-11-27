import { describe, expect, it } from 'vitest';
import { seedOptions } from '../rules/options.testing';
import { modelOutputSchema } from '../schema';
import {
  APPLY_KINDS,
  AUTHOR_RELATIONS,
  JUNK_REASONS,
  NOT_HIRING_REASONS,
  VERDICTS,
} from '../schema/post-extraction';
import {
  postPromptHash,
  postSystemPrompt,
  promptHash,
  systemPrompt,
} from './prompt';
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

  it('states what counts as an arrangement and who limiting words bind', () => {
    expect(text).toContain('"flexibility" on its own');
    expect(text).toContain('commuting distance');
    expect(text).toContain('"the position is based in Herndon"');
    expect(text).toContain('"open to PL based candidates"');
    expect(text).toContain('An authorization line is not a place');
    expect(text).toContain('hybrid and remote options');
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

describe('postSystemPrompt', () => {
  const text = postSystemPrompt();

  it('pins the listing prompt hash (update it with every prompt edit)', () => {
    expect(promptHash()).toBe(
      'ea379b22466b6561aead9d0a0df29844e2297a713fd4cb7a88b50c70008730bf',
    );
  });

  it('is the post head followed by the listing prompt', () => {
    expect(text.endsWith(`\n\n${SYSTEM_PROMPT}`)).toBe(true);
    expect(text.length).toBeGreaterThan(SYSTEM_PROMPT.length + 2);
  });

  it('ties the links to their kinds, as the document schema does', () => {
    expect(text).toContain(
      '`links` is non-empty exactly when `kinds` has `external_link` or `linkedin_job`.',
    );
  });

  it('has its own hash', () => {
    expect(postPromptHash()).toMatch(/^[0-9a-f]{64}$/);
    expect(postPromptHash()).not.toBe(promptHash());
  });

  it('names every verdict, reason code, apply kind and author relation', () => {
    const head = text.slice(0, text.length - SYSTEM_PROMPT.length);
    for (const code of [
      ...VERDICTS,
      ...NOT_HIRING_REASONS,
      ...JUNK_REASONS,
      ...APPLY_KINDS,
      ...AUTHOR_RELATIONS,
    ])
      expect(head).toContain(`\`${code}\``);
  });

  it('states the owner junk signs and when a relayed role is sure hiring', () => {
    const head = text.slice(0, text.length - SYSTEM_PROMPT.length);
    for (const sign of [
      'job-hunting group',
      'personal mailbox',
      'Hashtags alone',
      'bare titles',
      'relays one employer',
      'hundreds of openings',
      'not a personal mailbox',
      'list of titles at one named employer',
      'not a funnel',
      'Never record a sure `junk`',
    ])
      expect(head).toContain(sign);
    expect(head).not.toMatch(/[\w.+-]+@[\w-]+\.\w+/);
  });

  it('names the fields the model fills for a post', () => {
    const head = text.slice(0, text.length - SYSTEM_PROMPT.length);
    for (const name of [
      'verdict',
      'reason',
      'roles',
      'employer',
      'authorRelation',
      'howToApply',
      'kinds',
      'emailQuote',
      'links',
    ])
      expect(head).toContain(name);
  });
});
