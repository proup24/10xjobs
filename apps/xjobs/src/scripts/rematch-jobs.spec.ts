import { parseRematchArgs } from './rematch-args';

describe('parseRematchArgs', () => {
  it('reads --all', () => {
    expect(parseRematchArgs(['--all'])).toEqual({ all: true });
  });

  it("collects every --job id and drops pnpm's leading separator", () => {
    expect(parseRematchArgs(['--', '--job', 'a', '--job', 'b'])).toEqual({
      jobIds: ['a', 'b'],
    });
  });

  it('needs a selector', () => {
    expect(() => parseRematchArgs([])).toThrow(/--all or at least one --job/);
  });

  it('needs an id after --job', () => {
    expect(() => parseRematchArgs(['--job'])).toThrow(/needs an id/);
    expect(() => parseRematchArgs(['--job', '--all'])).toThrow(/needs an id/);
  });

  it('refuses unknown arguments and mixed selectors', () => {
    expect(() => parseRematchArgs(['--nope'])).toThrow(/unknown argument/);
    expect(() => parseRematchArgs(['--all', '--job', 'a'])).toThrow(
      /cannot be combined/,
    );
  });
});
