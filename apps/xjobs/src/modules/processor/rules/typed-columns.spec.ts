import { describe, expect, it } from 'vitest';
import { fixtureDocument } from '../schema/fixture.testing';
import { deriveTypedColumns } from './typed-columns';

const regions = new Map([['EMEA', ['MA', 'FR']]]);

describe('deriveTypedColumns', () => {
  it('expands a region opening into countries', () => {
    const cols = deriveTypedColumns(fixtureDocument(), regions);
    expect(cols.regionCodes).toEqual(['EMEA']);
    expect(cols.countryCodes).toEqual(['FR', 'MA']);
    expect(cols.worldwide).toBe(false);
  });

  it('flags worldwide', () => {
    const doc = fixtureDocument();
    doc.openings[0].places = [{ kind: 'worldwide' }];
    expect(deriveTypedColumns(doc, regions).worldwide).toBe(true);
  });

  it('splits tags by kind and keeps unresolved terms out of every column', () => {
    const doc = fixtureDocument();
    const r = (
      code: string | null,
      kind: 'main' | 'must' | 'nice',
      importance: number,
      group: string | null = null,
    ) => ({
      technology: { text: code ?? 'Frobnicator', code },
      kind,
      importance,
      domain: null,
      years: null,
      quote: '',
      confidence: 'sure' as const,
      group,
    });
    doc.techStack.value = {
      requirements: [
        r('python', 'main', 9),
        r('go', 'must', 6, 'g1'),
        r('rust', 'must', 6, 'g1'),
        r('docker', 'nice', 2),
        r(null, 'must', 6),
      ],
      groups: [{ id: 'g1', min: 1 }],
    };
    const cols = deriveTypedColumns(doc, regions);
    expect(cols.mainStackTags).toEqual(['python']);
    expect(cols.requiredTags).toEqual(['go', 'python', 'rust']);
    expect(cols.niceTags).toEqual(['docker']);
    expect(cols.techTags).toEqual(['docker', 'go', 'python', 'rust']);
  });

  it('maps null values to null columns', () => {
    const doc = fixtureDocument();
    doc.techStack.value = null;
    doc.seniority.value = null;
    doc.salary.value = null;
    const cols = deriveTypedColumns(doc, regions);
    expect(cols.techTags).toEqual([]);
    expect(cols.requiredTags).toEqual([]);
    expect(cols.niceTags).toEqual([]);
    expect(cols.seniority).toBeNull();
    expect(cols.salaryMin).toBeNull();
  });

  it('adds a city country even without a cityId', () => {
    const doc = fixtureDocument();
    doc.openings[0].places = [
      { kind: 'city', name: 'Paris', countryCode: 'FR', cityId: null },
    ];
    const cols = deriveTypedColumns(doc, regions);
    expect(cols.countryCodes).toEqual(['FR']);
    expect(cols.cityIds).toEqual([]);
  });

  it('collects cityIds', () => {
    const doc = fixtureDocument();
    doc.openings[0].places = [
      { kind: 'city', name: 'Paris', countryCode: 'FR', cityId: 'c1' },
    ];
    expect(deriveTypedColumns(doc, regions).cityIds).toEqual(['c1']);
  });

  it('maps a non-null salary', () => {
    const cols = deriveTypedColumns(fixtureDocument(), regions);
    expect(cols).toMatchObject({
      salaryMin: 80000,
      salaryMax: 100000,
      salaryCurrency: 'EUR',
      salaryPeriod: 'year',
    });
  });

  it('merges a region with a country, deduplicated', () => {
    const doc = fixtureDocument();
    doc.openings[0].places = [
      { kind: 'region', code: 'EMEA' },
      { kind: 'country', code: 'DE' },
      { kind: 'country', code: 'FR' },
    ];
    expect(deriveTypedColumns(doc, regions).countryCodes).toEqual([
      'DE',
      'FR',
      'MA',
    ]);
  });

  it('keeps an unknown region code and adds no countries', () => {
    const doc = fixtureDocument();
    doc.openings[0].places = [{ kind: 'region', code: 'APAC' }];
    const cols = deriveTypedColumns(doc, regions);
    expect(cols.regionCodes).toEqual(['APAC']);
    expect(cols.countryCodes).toEqual([]);
  });
});
