import { TECHNOLOGY_TERMS } from './keywords';
import { SEARCH_SPELLINGS, searchSpellings } from './search-spellings';

describe('searchSpellings', () => {
  it('lists both spellings of node.js', () => {
    expect(searchSpellings('nodejs')).toEqual(
      expect.arrayContaining(['nodejs', 'node.js']),
    );
  });

  it('falls back to the technology term', () => {
    expect(searchSpellings('csharp')).toEqual(['c#']);
  });

  it('throws for a non-searchable technology', () => {
    expect(() => searchSpellings('golang')).toThrow();
  });

  it('keys SEARCH_SPELLINGS by technology terms', () => {
    for (const key of Object.keys(SEARCH_SPELLINGS)) {
      expect(TECHNOLOGY_TERMS).toHaveProperty(key);
    }
  });
});
