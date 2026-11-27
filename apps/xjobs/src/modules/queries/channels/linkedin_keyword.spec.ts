import {
  keywordTerm,
  LINKEDIN_KEYWORD_MAX_CHARS,
  LINKEDIN_KEYWORD_MAX_TERMS,
  linkedinKeyword,
  linkedinKeywordFits,
} from './linkedin_keyword';
import { searchSpellings } from '../builders/search-spellings';

describe('keywordTerm', () => {
  it('lowercases and quotes only terms with a space or one of .#+', () => {
    expect(keywordTerm('React')).toBe('react');
    expect(keywordTerm('Node.js')).toBe('"node.js"');
    expect(keywordTerm('Next JS')).toBe('"next js"');
    expect(keywordTerm('C#')).toBe('"c#"');
    expect(keywordTerm('C++')).toBe('"c++"');
  });
});

describe('linkedinKeyword', () => {
  it('joins role words AND spellings, each side sorted', () => {
    expect(
      linkedinKeyword(
        ['developer', 'engineer'],
        ['react', 'node.js', 'next js'],
      ),
    ).toBe('(developer OR engineer) AND ("next js" OR "node.js" OR react)');
  });

  it('does not depend on input order and dedupes after keywordTerm', () => {
    expect(
      linkedinKeyword(
        ['engineer', 'Developer', 'developer'],
        ['react', 'React'],
      ),
    ).toBe(linkedinKeyword(['developer', 'engineer'], ['react']));
  });

  it('keeps parentheses around a single term', () => {
    expect(linkedinKeyword(['engineer'], ['react'])).toBe(
      '(engineer) AND (react)',
    );
  });

  it('throws when a side is empty', () => {
    expect(() => linkedinKeyword([], ['react'])).toThrow();
    expect(() => linkedinKeyword(['engineer'], [])).toThrow();
  });
});

describe('linkedinKeyword with the claude tags', () => {
  it('searches claude code as one phrase', () => {
    expect(linkedinKeyword(['engineer'], searchSpellings('claude_code'))).toBe(
      '(engineer) AND ("claude code")',
    );
  });

  it('keeps claude and claude code apart', () => {
    const keyword = linkedinKeyword(
      ['engineer'],
      [...searchSpellings('claude'), ...searchSpellings('claude_code')],
    );
    expect(keyword).toBe('(engineer) AND ("claude code" OR claude)');
    expect(keyword.match(/claude code/g)).toHaveLength(1);
    expect(keyword.match(/claude(?! code)/g)).toHaveLength(1);
  });
});

describe('linkedinKeywordFits', () => {
  // A 398-character, 34-term superset of the 319-character, 25-term dev
  // keyword returned 51 jobs against 430: LinkedIn silently degrades longer
  // queries.
  const terms = (n: number, len = 3) =>
    Array.from({ length: n }, (_, i) => `t${String(i).padStart(len - 1, '0')}`);

  it('is true at the term limit and false one term over', () => {
    expect(
      linkedinKeywordFits(['role'], terms(LINKEDIN_KEYWORD_MAX_TERMS - 1)),
    ).toBe(true);
    expect(
      linkedinKeywordFits(['role'], terms(LINKEDIN_KEYWORD_MAX_TERMS)),
    ).toBe(false);
  });

  it('counts distinct terms after keywordTerm, both sides', () => {
    expect(linkedinKeywordFits(['Role', 'role'], [...terms(24), 'T00'])).toBe(
      true,
    );
  });

  it('is true at the character limit and false one character over', () => {
    // "(a) AND (<spelling>)" is 10 characters plus the spelling.
    const at = 'x'.repeat(LINKEDIN_KEYWORD_MAX_CHARS - 10);
    expect(linkedinKeyword(['a'], [at]).length).toBe(
      LINKEDIN_KEYWORD_MAX_CHARS,
    );
    expect(linkedinKeywordFits(['a'], [at])).toBe(true);
    expect(linkedinKeywordFits(['a'], [at + 'x'])).toBe(false);
  });
});

describe('the remote word', () => {
  it('appends AND remote outside the groups', () => {
    expect(linkedinKeyword(['engineer'], ['react'], { remote: true })).toBe(
      '(engineer) AND (react) AND remote',
    );
    expect(linkedinKeyword(['engineer'], ['react'], { remote: false })).toBe(
      '(engineer) AND (react)',
    );
  });

  it('counts its characters and its term against the limits', () => {
    const roles = ['engineer'];
    // `(engineer) AND (` + `)` = 17 characters around the spellings.
    const spelling = 'a'.repeat(LINKEDIN_KEYWORD_MAX_CHARS - 17);
    expect(linkedinKeyword(roles, [spelling]).length).toBe(
      LINKEDIN_KEYWORD_MAX_CHARS,
    );
    expect(linkedinKeywordFits(roles, [spelling])).toBe(true);
    expect(linkedinKeywordFits(roles, [spelling], { remote: true })).toBe(
      false,
    );
    const terms = Array.from(
      { length: LINKEDIN_KEYWORD_MAX_TERMS - 1 },
      (_, i) => `t${i}`,
    );
    expect(linkedinKeywordFits(roles, terms)).toBe(true);
    expect(linkedinKeywordFits(roles, terms, { remote: true })).toBe(false);
  });
});
