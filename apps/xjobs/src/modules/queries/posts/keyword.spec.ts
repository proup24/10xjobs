import { postKeyword, postKeywordFits, postOperators } from './keyword';

const spellings = ['typescript', 'react', 'reactjs', 'nodejs', 'nextjs'];

describe('postKeyword', () => {
  it('builds the English remote keyword', () => {
    expect(
      postKeyword({
        hiringWord: 'hiring',
        positionWords: ['fullstack', 'full stack'],
        spellings,
        remote: true,
      }),
    ).toBe(
      'hiring (fullstack OR "full stack") (typescript OR react OR reactjs OR nodejs OR nextjs) remote',
    );
  });

  it('builds the French keyword without arrangement', () => {
    expect(
      postKeyword({
        hiringWord: 'recrute',
        positionWords: ['fullstack', 'full stack'],
        spellings,
        remote: false,
      }),
    ).toBe(
      'recrute (fullstack OR "full stack") (typescript OR react OR reactjs OR nodejs OR nextjs)',
    );
  });

  it('writes a one-term group bare', () => {
    expect(
      postKeyword({
        hiringWord: 'hiring',
        positionWords: ['devops'],
        spellings: ['aws'],
        remote: true,
      }),
    ).toBe('hiring devops aws remote');
  });

  it('counts operators', () => {
    const base = { hiringWord: 'hiring', remote: true };
    const two = ['fullstack', 'full stack'];
    const five = { ...base, positionWords: two, spellings };
    expect(postOperators(five)).toBe(5);
    expect(postKeywordFits(five)).toBe(true);
    const six = { ...five, spellings: [...spellings, 'vue'] };
    expect(postOperators(six)).toBe(6);
    expect(postKeywordFits(six)).toBe(false);
  });

  it('rejects a keyword over 500 characters', () => {
    expect(
      postKeywordFits({
        hiringWord: 'hiring',
        positionWords: ['devops'],
        spellings: ['x'.repeat(500)],
        remote: true,
      }),
    ).toBe(false);
  });
});
