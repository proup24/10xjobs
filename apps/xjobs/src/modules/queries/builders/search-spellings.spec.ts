import { TECHNOLOGY_TERMS } from './keywords';
import { SEARCH_SPELLINGS, searchSpellings } from './search-spellings';

describe('searchSpellings', () => {
  it('lists both spellings of node.js', () => {
    expect(searchSpellings('nodejs')).toEqual(
      expect.arrayContaining(['nodejs', 'node.js']),
    );
  });

  it('lists both spellings of next.js and nest.js', () => {
    expect(searchSpellings('nextjs')).toEqual(['nextjs', 'next.js']);
    expect(searchSpellings('nestjs')).toEqual(['nestjs', 'nest.js']);
  });

  it('lists both spellings of llm', () => {
    expect(searchSpellings('llm')).toEqual(['llm', 'llms']);
  });

  it('uses the plain term for claude code', () => {
    expect(searchSpellings('claude_code')).toEqual(['claude code']);
  });

  it('has an entry for every technology term', () => {
    for (const key of Object.keys(TECHNOLOGY_TERMS)) {
      expect(SEARCH_SPELLINGS).toHaveProperty(key);
    }
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
