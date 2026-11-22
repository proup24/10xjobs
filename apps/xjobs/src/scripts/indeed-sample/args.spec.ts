import { parseSampleArgs } from './args';

describe('parseSampleArgs', () => {
  it('reads --profile and drops a literal --', () => {
    expect(parseSampleArgs(['--', '--profile', 'p1'])).toEqual({
      profile: 'p1',
      dryRun: false,
    });
  });

  it('reads --dry-run', () => {
    expect(parseSampleArgs(['--profile', 'p1', '--dry-run'])).toEqual({
      profile: 'p1',
      dryRun: true,
    });
  });

  it('reads --from without --profile', () => {
    expect(parseSampleArgs(['--', '--from', 'tmp/x'])).toEqual({
      profile: '',
      dryRun: false,
      from: 'tmp/x',
    });
  });

  it('needs --profile unless --from is given', () => {
    expect(() => parseSampleArgs([])).toThrow(/--profile/);
    expect(() => parseSampleArgs(['--', '--dry-run'])).toThrow(/--profile/);
  });

  it('refuses --dry-run with --from', () => {
    expect(() => parseSampleArgs(['--dry-run', '--from', 'x'])).toThrow(
      /--dry-run/,
    );
  });

  it('refuses a flag with no value and unknown flags', () => {
    expect(() => parseSampleArgs(['--profile'])).toThrow(/--profile/);
    expect(() => parseSampleArgs(['--from', '--dry-run'])).toThrow(/--from/);
    expect(() => parseSampleArgs(['--profile', 'p', '--x'])).toThrow(
      /unknown argument/,
    );
  });
});
