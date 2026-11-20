import { POSITION_TITLES } from '../builders/keywords';
import {
  POST_HIRING_WORDS,
  POST_LANGUAGES,
  POST_POSITION_WORDS,
  postSpellings,
} from './words';

describe('post words', () => {
  it('has hiring words for en and fr only', () => {
    expect(POST_LANGUAGES).toEqual(['en', 'fr']);
    expect(POST_HIRING_WORDS).toEqual({ en: 'hiring', fr: 'recrute' });
  });

  it('has 1 or 2 position words for every position', () => {
    expect(Object.keys(POST_POSITION_WORDS).sort()).toEqual(
      Object.keys(POSITION_TITLES).sort(),
    );
    for (const words of Object.values(POST_POSITION_WORDS)) {
      expect(words.length).toBeGreaterThanOrEqual(1);
      expect(words.length).toBeLessThanOrEqual(2);
    }
  });

  it('merges dot spellings and adds reactjs', () => {
    expect(postSpellings(['nodejs', 'react', 'nextjs', 'nestjs'])).toEqual([
      { technology: 'nodejs', spellings: ['nodejs'] },
      { technology: 'react', spellings: ['react', 'reactjs'] },
      { technology: 'nextjs', spellings: ['nextjs'] },
      { technology: 'nestjs', spellings: ['nestjs'] },
    ]);
  });

  it('drops react native when react is searched', () => {
    expect(
      postSpellings(['react', 'react_native']).map((t) => t.technology),
    ).toEqual(['react']);
    expect(postSpellings(['react_native'])).toEqual([
      { technology: 'react_native', spellings: ['react native'] },
    ]);
  });

  it('keeps a leading dot', () => {
    expect(postSpellings(['dotnet'])[0].spellings).toEqual(['.net']);
  });
});
