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

  it('unions tech tags and keeps main stack separate', () => {
    const cols = deriveTypedColumns(fixtureDocument(), regions);
    expect(cols.techTags).toEqual(['nodejs', 'rust', 'sql']);
    expect(cols.mainStackTags).toEqual(['nodejs']);
  });

  it('skips null codes and maps null values to null columns', () => {
    const doc = fixtureDocument();
    doc.techStack.value!.niceToHaves.push({ text: 'x', code: null });
    doc.seniority.value = null;
    doc.salary.value = null;
    const cols = deriveTypedColumns(doc, regions);
    expect(cols.techTags).toEqual(['nodejs', 'rust', 'sql']);
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
