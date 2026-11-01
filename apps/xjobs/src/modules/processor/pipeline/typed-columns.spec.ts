import { describe, expect, it } from 'vitest';
import { fixtureDocument } from '../schema/fixture';
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
});
