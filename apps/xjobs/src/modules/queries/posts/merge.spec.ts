import { mergedPostKeyword } from './merge';

const member = (spellings: string[]) => ({
  params: {
    language: 'en',
    position: 'fullstack',
    hiringWord: 'hiring',
    positionWords: ['fullstack', 'full stack'],
    spellings,
    remote: true,
  },
});

describe('mergedPostKeyword', () => {
  it("merges two members' spellings", () => {
    expect(
      mergedPostKeyword([
        member(['react', 'reactjs']),
        member(['react', 'go']),
      ]),
    ).toBe(
      'hiring (fullstack OR "full stack") (react OR reactjs OR go) remote',
    );
  });
});
