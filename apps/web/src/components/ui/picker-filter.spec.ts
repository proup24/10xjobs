import { describe, expect, it } from 'vitest';
import { filterOptions, type PickerOption } from './picker-filter';

const cities: PickerOption[] = [
  { value: 'alberta', label: 'Alberta' },
  { value: 'berlin', label: 'Berlin' },
  { value: 'zurich', label: 'Zürich' },
  { value: 'us', label: 'United States', keywords: ['USA', 'America'] },
];

function labels(options: PickerOption[]) {
  return options.map((option) => option.label);
}

describe('filterOptions', () => {
  it('ignores accents: "zurich" finds Zürich', () => {
    expect(labels(filterOptions(cities, 'zurich'))).toEqual(['Zürich']);
  });

  it('ignores accents in the query too: "zür" finds Zürich', () => {
    expect(labels(filterOptions(cities, 'ZÜR'))).toEqual(['Zürich']);
  });

  it('matches keywords: "usa" finds United States', () => {
    expect(labels(filterOptions(cities, 'usa'))).toEqual(['United States']);
  });

  it('puts prefix matches before substring matches: "ber" gives Berlin, Alberta', () => {
    expect(labels(filterOptions(cities, 'ber'))).toEqual(['Berlin', 'Alberta']);
  });

  it('keeps the original order within each group', () => {
    const options = [
      { value: 'b', label: 'Xa second' },
      { value: 'a', label: 'a first' },
      { value: 'c', label: 'ab third' },
      { value: 'd', label: 'Xa fourth' },
    ];
    expect(labels(filterOptions(options, 'a'))).toEqual([
      'a first',
      'ab third',
      'Xa second',
      'Xa fourth',
    ]);
  });

  it('trims the query and returns everything (up to the limit) when it is empty', () => {
    expect(labels(filterOptions(cities, '  '))).toEqual(labels(cities));
  });

  it('returns nothing when nothing matches', () => {
    expect(filterOptions(cities, 'tokyo')).toEqual([]);
  });

  describe('with 2,000 options', () => {
    const many = Array.from({ length: 2000 }, (_, i) => ({
      value: `option-${i}`,
      label: `Option ${i}`,
    }));

    it('returns at most 50 for an empty query', () => {
      expect(filterOptions(many, '')).toHaveLength(50);
    });

    it('still finds the last option by typing', () => {
      expect(filterOptions(many, 'option 1999')).toEqual([
        { value: 'option-1999', label: 'Option 1999' },
      ]);
    });

    it('honours a custom limit', () => {
      expect(filterOptions(many, 'option', 10)).toHaveLength(10);
    });
  });
});
