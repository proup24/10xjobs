import {
  checkCaseIndices,
  parseEvalArgs,
  parseReprocessArgs,
  parseVocabArgs,
} from './processor-args';

describe('parseReprocessArgs', () => {
  it('reads each selector', () => {
    expect(parseReprocessArgs(['--null-status'])).toEqual({ nullStatus: true });
    expect(parseReprocessArgs(['--all-in-scope', '--failed'])).toEqual({
      allInScope: true,
      failed: true,
    });
  });

  it('reads --matched alone', () => {
    expect(parseReprocessArgs(['--matched'])).toEqual({ matched: true });
  });

  it('collects every --job id', () => {
    expect(parseReprocessArgs(['--job', 'a', '--job', 'b'])).toEqual({
      jobIds: ['a', 'b'],
    });
  });

  it('refuses no selector', () => {
    expect(() => parseReprocessArgs([])).toThrow(
      'pass at least one of --all-in-scope, --null-status, --failed, --matched, --job',
    );
  });

  it('refuses --job without an id and unknown flags', () => {
    expect(() => parseReprocessArgs(['--job'])).toThrow('--job needs an id');
    expect(() => parseReprocessArgs(['--nope'])).toThrow('unknown argument');
  });
});

describe('a leading -- forwarded by pnpm', () => {
  it('is dropped by both parsers', () => {
    expect(parseReprocessArgs(['--', '--null-status'])).toEqual({
      nullStatus: true,
    });
    expect(parseVocabArgs(['--', 'techTags', 'list'])).toEqual({
      list: 'techTags',
      action: 'list',
    });
  });
});

describe('parseVocabArgs', () => {
  it('refuses leftover arguments', () => {
    expect(() => parseVocabArgs(['techTags', 'list', 'x'])).toThrow(
      'unexpected argument: x',
    );
    expect(() => parseVocabArgs(['techTags', 'approve', 'a', 'b'])).toThrow(
      'unexpected argument: b',
    );
    expect(() =>
      parseVocabArgs(['techTags', 'alias', 'a', '--to', 'b', 'c']),
    ).toThrow('unexpected argument: c');
  });

  it('parses list, approve, reject and alias', () => {
    expect(parseVocabArgs(['techTags', 'list'])).toEqual({
      list: 'techTags',
      action: 'list',
    });
    expect(parseVocabArgs(['techTags', 'approve', 'bun'])).toEqual({
      list: 'techTags',
      action: 'approve',
      code: 'bun',
    });
    expect(parseVocabArgs(['junkFlags', 'reject', 'x'])).toEqual({
      list: 'junkFlags',
      action: 'reject',
      code: 'x',
    });
    expect(
      parseVocabArgs(['techTags', 'alias', 'bun', '--to', 'javascript']),
    ).toEqual({
      list: 'techTags',
      action: 'alias',
      code: 'bun',
      to: 'javascript',
    });
  });

  it('takes cities by id', () => {
    expect(parseVocabArgs(['cities', 'list'])).toEqual({
      list: 'cities',
      action: 'list',
    });
    expect(parseVocabArgs(['cities', 'approve', 'id-1'])).toEqual({
      list: 'cities',
      action: 'approve',
      code: 'id-1',
    });
  });

  it('parses cities alias <id> --as <spelling>', () => {
    expect(parseVocabArgs(['cities', 'alias', 'id-1', '--as', 'Fez'])).toEqual({
      list: 'cities',
      action: 'alias',
      code: 'id-1',
      spelling: 'Fez',
    });
  });

  it('city alias needs --as, and list aliases need --to', () => {
    expect(() => parseVocabArgs(['cities', 'alias', 'id-1'])).toThrow('--as');
    expect(() =>
      parseVocabArgs(['cities', 'alias', 'id-1', '--to', 'id-2']),
    ).toThrow('--as');
    expect(() =>
      parseVocabArgs(['techTags', 'alias', 'a', '--as', 'b']),
    ).toThrow('--to');
  });

  it('refuses an unknown list, action or a missing code or target', () => {
    expect(() => parseVocabArgs(['nope', 'list'])).toThrow('unknown list');
    expect(() => parseVocabArgs(['techTags', 'merge'])).toThrow(
      'unknown action',
    );
    expect(() => parseVocabArgs(['techTags', 'approve'])).toThrow(
      'needs a code',
    );
    expect(() => parseVocabArgs(['techTags', 'alias', 'bun'])).toThrow('--to');
  });
});

describe('parseEvalArgs', () => {
  it('runs listings with the default generator when given nothing', () => {
    expect(parseEvalArgs([])).toEqual({ posts: false });
    expect(parseEvalArgs(['--'])).toEqual({ posts: false });
  });

  it('reads --posts and --generator', () => {
    expect(parseEvalArgs(['--', '--posts', '--generator', 'sonnet'])).toEqual({
      posts: true,
      generator: 'sonnet',
    });
  });

  it('refuses a --generator with no model and an unknown argument', () => {
    expect(() => parseEvalArgs(['--generator'])).toThrow(
      '--generator needs a model',
    );
    expect(() => parseEvalArgs(['--post'])).toThrow('unknown argument: --post');
  });

  it('collects repeated --case indices with --posts', () => {
    expect(parseEvalArgs(['--posts', '--case', '71', '--case', '129'])).toEqual(
      { posts: true, cases: [71, 129] },
    );
    expect(parseEvalArgs(['--case', '0', '--posts', '--case', '0'])).toEqual({
      posts: true,
      cases: [0],
    });
  });

  it('refuses --case without --posts, without a value, or with a bad index', () => {
    expect(() => parseEvalArgs(['--case', '71'])).toThrow(
      '--case only works with --posts',
    );
    expect(() => parseEvalArgs(['--posts', '--case'])).toThrow(
      '--case needs a case index',
    );
    expect(() => parseEvalArgs(['--posts', '--case', '--generator'])).toThrow(
      '--case needs a case index',
    );
    for (const bad of ['x', '1.5', '-1', '7a'])
      expect(() => parseEvalArgs(['--posts', '--case', bad])).toThrow(
        `--case needs a whole number, got ${bad}`,
      );
  });
});

describe('checkCaseIndices', () => {
  it('accepts indices inside the golden set and refuses one outside it', () => {
    expect(() => checkCaseIndices([0, 149], 150)).not.toThrow();
    expect(() => checkCaseIndices([150], 150)).toThrow(
      '--case 150 is out of range: the post golden set has 150 cases (0-149)',
    );
  });
});
