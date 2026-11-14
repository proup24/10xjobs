import {
  candidateForms,
  checkTotalsPlan,
  roleWordGaps,
  spellingShares,
  suggestSpellings,
  unusedSpellings,
} from './logic';

describe('spellingShares', () => {
  it('counts each spelling, case-insensitive and word-bounded', () => {
    const shares = spellingShares(
      ['Node.js dev', 'NodeJS', 'node js'],
      'nodejs',
      ['nodejs', 'node.js', 'node js'],
    );
    expect(shares.map((s) => s.spelling)).toEqual([
      'nodejs',
      'node.js',
      'node js',
    ]);
    for (const s of shares) expect(s.share).toBeCloseTo(1 / 3, 5);
  });

  it('does not match inside a longer word', () => {
    const [only] = spellingShares(['reactive', 'React dev'], 'react', [
      'react',
    ]);
    expect(only.share).toBe(0.5);
  });

  it('matches a spelling that ends in punctuation', () => {
    const [only] = spellingShares(['We use C++, daily'], 'cpp', ['c++']);
    expect(only.share).toBe(1);
  });

  it('is zero for no texts', () => {
    expect(spellingShares([], 'react', ['react'])).toEqual([
      { spelling: 'react', share: 0 },
    ]);
  });
});

describe('suggestSpellings', () => {
  it('drops known spellings and keeps one at 0.2', () => {
    const shares = [
      { spelling: 'nodejs', share: 0.5 },
      { spelling: 'node js', share: 0.2 },
      { spelling: 'node-js', share: 0.05 },
    ];
    expect(suggestSpellings(shares, ['NodeJS', 'node.js'])).toEqual([
      'node js',
    ]);
  });

  it('keeps a spelling exactly at the threshold', () => {
    expect(suggestSpellings([{ spelling: 'a b', share: 0.1 }], [])).toEqual([
      'a b',
    ]);
  });
});

describe('roleWordGaps', () => {
  it('flags an engineering title with no role word of its languages', () => {
    const gaps = roleWordGaps([
      {
        title: 'Solutions Architect',
        languages: ['en'],
        position: 'engineering_manager',
      },
      {
        title: 'Senior Backend Engineer',
        languages: ['en'],
        position: 'backend_engineer',
      },
      {
        title: 'Office Manager',
        languages: ['en'],
        position: 'backend_engineer',
      },
    ]);
    expect(gaps).toEqual([{ title: 'Solutions Architect' }]);
  });

  it('counts the words of the profile languages', () => {
    const job = {
      title: 'Développeur Java',
      languages: ['fr'],
      position: 'backend_engineer',
    };
    expect(roleWordGaps([job])).toEqual([]);
    expect(roleWordGaps([{ ...job, languages: ['en'] }])).toEqual([
      { title: 'Développeur Java' },
    ]);
  });

  it('lists a title once', () => {
    const job = {
      title: 'Software Wizard',
      languages: ['en'],
      position: 'backend_engineer',
    };
    expect(roleWordGaps([job, job])).toEqual([{ title: 'Software Wizard' }]);
  });
});

describe('unusedSpellings', () => {
  it('lists spellings that are the only match in no job', () => {
    const jobs = [
      { text: 'We use Node.js and NodeJS' },
      { text: 'nodejs backend' },
      { text: 'node js scripts' },
    ];
    expect(unusedSpellings(jobs, ['nodejs', 'node.js', 'node js'])).toEqual([
      'node.js',
    ]);
  });

  it('lists every spelling when no job matches', () => {
    expect(unusedSpellings([{ text: 'nothing' }], ['a1', 'b1'])).toEqual([
      'a1',
      'b1',
    ]);
  });
});

describe('candidateForms', () => {
  it('adds aliases and case and punctuation variants, lowercase and deduped', () => {
    expect(
      candidateForms(['nodejs', 'node.js'], ['Node JS', 'NodeJS']),
    ).toEqual(['node js', 'node.js', 'nodejs']);
  });

  it('keeps symbol spellings and does not invent variants of them', () => {
    expect(candidateForms(['c++'], [])).toEqual(['c++']);
  });

  it('splits a hyphenated spelling', () => {
    expect(candidateForms(['vue-js'], [])).toEqual([
      'vue js',
      'vue-js',
      'vuejs',
    ]);
  });
});

describe('checkTotalsPlan', () => {
  it('reserves each 3-row run and refuses past the $0.10 cap', () => {
    const ok = checkTotalsPlan(['a', 'b']);
    expect(ok.runs).toHaveLength(2);
    expect(ok.fits).toBe(true);
    expect(ok.reservedUsd).toBeCloseTo(2 * 0.009, 6);
    expect(
      checkTotalsPlan(Array.from({ length: 12 }, (_, i) => `t${i}`)).fits,
    ).toBe(false);
  });
});
