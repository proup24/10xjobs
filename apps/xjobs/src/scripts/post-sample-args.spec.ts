import { parsePostSampleArgs } from './post-sample-args';

describe('parsePostSampleArgs', () => {
  it('reads size and out, and drops the leading separator', () => {
    expect(
      parsePostSampleArgs(['--', '--size', '5', '--out', 'a.json']),
    ).toEqual({ size: 5, days: undefined, out: 'a.json' });
  });

  it('reads --days', () => {
    expect(
      parsePostSampleArgs(['--size', '150', '--days', '30', '--out', 'a.json']),
    ).toEqual({ size: 150, days: 30, out: 'a.json' });
  });

  it('needs --size and --out', () => {
    expect(() => parsePostSampleArgs(['--out', 'a'])).toThrow(/--size/);
    expect(() => parsePostSampleArgs(['--size', '5'])).toThrow(/--out/);
  });

  it('rejects a size or days that is not a positive whole number', () => {
    for (const bad of ['0', '-1', '1.5', 'x', '']) {
      expect(() => parsePostSampleArgs(['--size', bad, '--out', 'a'])).toThrow(
        /--size/,
      );
      expect(() =>
        parsePostSampleArgs(['--size', '5', '--days', bad, '--out', 'a']),
      ).toThrow(/--days/);
    }
  });

  it('needs a value after --out', () => {
    expect(() => parsePostSampleArgs(['--size', '5', '--out'])).toThrow(
      /--out needs a path/,
    );
    expect(() =>
      parsePostSampleArgs(['--size', '5', '--out', '--days']),
    ).toThrow(/--out needs a path/);
  });

  it('rejects unknown flags', () => {
    expect(() =>
      parsePostSampleArgs(['--size', '5', '--out', 'a', '--all']),
    ).toThrow(/unknown argument: --all/);
  });
});
