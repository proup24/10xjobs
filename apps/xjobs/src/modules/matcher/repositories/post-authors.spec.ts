import { describe, expect, it } from 'vitest';
import { postAuthors } from './matcher.repository';

describe('postAuthors', () => {
  it("reads each source's author and each share's original author, deduplicated by lowercased key", () => {
    expect(
      postAuthors({
        sources: [
          {
            author: { key: 'profile:Jane-Doe', name: 'Jane Doe' },
            original: null,
          },
          {
            author: { key: 'profile:sam', name: null },
            original: { author: { key: 'profile:jane-doe', name: 'Jane' } },
          },
          { author: { key: null, name: 'No key' }, original: { author: null } },
        ],
      }),
    ).toEqual([
      { key: 'profile:jane-doe', name: 'Jane Doe' },
      { key: 'profile:sam', name: '' },
    ]);
  });

  it('reads nothing from a missing or malformed postSources', () => {
    expect(postAuthors(null)).toEqual([]);
    expect(postAuthors({ sources: 'x' })).toEqual([]);
  });
});
