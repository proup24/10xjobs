import { describe, expect, it } from 'vitest';
import { ExtractionInvalidError } from '../models/errors';
import { fixtureDocument } from '../schema/fixture.testing';
import { LIST_NAMES, type ListName } from './lists';
import { resolveTerms, slugCode, type VocabSnapshot } from './resolve';

function vocab(): VocabSnapshot {
  const approved = {} as Record<ListName, Map<string, string>>;
  for (const l of LIST_NAMES) approved[l] = new Map();
  const add = (l: ListName, code: string, ...keys: string[]) => {
    for (const k of [code, ...keys]) approved[l].set(k.toLowerCase(), code);
  };
  add('techTags', 'postgresql', 'PostgreSQL', 'postgres');
  add('techTags', 'nodejs', 'Node.js');
  add('techTags', 'sql');
  add('techTags', 'rust');
  add('techTags', 'react', 'React', 'ReactJS');
  add('seniorities', 'senior');
  add('arrangements', 'remote');
  add('roleKinds', 'backend');
  add('contractTypes', 'full_time');
  add('engagements', 'employee');
  add('regions', 'EMEA');
  add('countries', 'FR');
  return { approved };
}

describe('resolveTerms', () => {
  it('alias-matches raw text', () => {
    const doc = fixtureDocument();
    doc.techStack.value!.requirements[0].technology = {
      text: 'ReactJS',
      code: null,
    };
    const r = resolveTerms(doc, vocab());
    expect(r.doc.techStack.value!.requirements[0].technology.code).toBe(
      'react',
    );
    expect(r.proposals).toEqual([]);
  });

  it('treats an unapproved code like raw text', () => {
    const doc = fixtureDocument();
    doc.techStack.value!.requirements[0].technology = {
      text: 'whatever',
      code: 'postgres',
    };
    expect(
      resolveTerms(doc, vocab()).doc.techStack.value!.requirements[0].technology
        .code,
    ).toBe('postgresql');
  });

  it('proposes an unknown term once and records each use unmatched', () => {
    const doc = fixtureDocument();
    const reqs = doc.techStack.value!.requirements;
    reqs[0].technology = { text: 'Bun', code: null };
    reqs[1].technology = { text: 'Bun', code: null };
    reqs[1].domain = 'frontend';
    const r = resolveTerms(doc, vocab());
    expect(r.doc.techStack.value!.requirements[0].technology.code).toBeNull();
    expect(r.doc.unmatched).toEqual([
      {
        list: 'techTags',
        text: 'Bun',
        at: 'techStack.requirements.0.technology',
      },
      {
        list: 'techTags',
        text: 'Bun',
        at: 'techStack.requirements.1.technology',
      },
    ]);
    expect(r.proposals).toEqual([{ list: 'techTags', text: 'Bun' }]);
  });

  it('collects cities', () => {
    const doc = fixtureDocument();
    doc.openings[0].places = [
      { kind: 'city', name: 'Paris', countryCode: 'FR', cityId: null },
    ];
    const r = resolveTerms(doc, vocab());
    expect(r.cities).toEqual([{ name: 'Paris', countryCode: 'FR' }]);
  });

  it('throws for an unapproved city country code', () => {
    const doc = fixtureDocument();
    doc.openings[0].places = [
      { kind: 'city', name: 'Paris', countryCode: 'XX', cityId: null },
    ];
    expect(() => resolveTerms(doc, vocab())).toThrow(ExtractionInvalidError);
  });

  it('throws for an unapproved choice code', () => {
    const doc = fixtureDocument();
    doc.seniority.value = 'guru';
    expect(() => resolveTerms(doc, vocab())).toThrow(ExtractionInvalidError);
  });

  it('accepts approved choice codes', () => {
    const doc = fixtureDocument();
    doc.position.value = { roleKind: 'backend', title: 't' };
    expect(() => resolveTerms(doc, vocab())).not.toThrow();
  });

  it('does not mutate its input', () => {
    const doc = fixtureDocument();
    doc.techStack.value!.requirements[0].technology = {
      text: 'Postgres',
      code: null,
    };
    resolveTerms(doc, vocab());
    expect(doc.techStack.value!.requirements[0].technology.code).toBeNull();
  });
});

describe('slugCode', () => {
  it('slugs text', () => {
    expect(slugCode('Node.js')).toBe('node_js');
    expect(slugCode('C#')).toBe('csharp');
    expect(slugCode('  Spring Boot ')).toBe('spring_boot');
  });
});
