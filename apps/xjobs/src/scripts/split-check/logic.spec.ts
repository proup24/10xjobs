import { linkedinKeyword } from 'src/modules/queries/channels/linkedin_keyword';
import {
  checkPlan,
  coverage,
  halfKeywords,
  inconclusive,
  pickGroup,
  type GroupCandidate,
} from './logic';

const member = (id: string, hash: string, spellings: string[] = ['go']) => ({
  id,
  hash,
  params: { roleWords: ['engineer'], spellings },
});
const group = (
  key: string,
  rows24h: number,
  members = [member('m', 'h')],
): GroupCandidate => ({ key, rows24h, members });

describe('pickGroup', () => {
  it('prefers the named key', () => {
    const groups = [group('a', 90), group('b', 30)];
    expect(pickGroup(groups, 'b').key).toBe('b');
  });

  it('takes the group with most rows under 120 by default', () => {
    const groups = [group('a', 30), group('b', 90), group('c', 200)];
    expect(pickGroup(groups).key).toBe('b');
  });

  it('throws when no group is left', () => {
    expect(() => pickGroup([group('c', 200)])).toThrow();
    expect(() => pickGroup([])).toThrow();
  });
});

describe('halfKeywords', () => {
  it('halves members in hash order, first half rounded up', () => {
    const g = group('k', 50, [
      member('c', 'h3', ['rust']),
      member('a', 'h1', ['go']),
      member('b', 'h2', ['java']),
    ]);
    const out = halfKeywords(g);
    expect(out.by).toBe('members');
    expect(out.halves[0]).toBe(linkedinKeyword(['engineer'], ['go', 'java']));
    expect(out.halves[1]).toBe(linkedinKeyword(['engineer'], ['rust']));
    expect(out.merged).toBe(
      linkedinKeyword(['engineer'], ['go', 'java', 'rust']),
    );
  });

  it('halves the spellings of a single member', () => {
    const g = group('k', 50, [member('a', 'h', ['rust', 'go', 'java'])]);
    const out = halfKeywords(g);
    expect(out.by).toBe('spellings');
    expect(out.halves[0]).toBe(linkedinKeyword(['engineer'], ['go', 'java']));
    expect(out.halves[1]).toBe(linkedinKeyword(['engineer'], ['rust']));
  });

  it('throws for one member with one spelling', () => {
    expect(() => halfKeywords(group('k', 5))).toThrow(
      'cannot halve: one member with fewer than 2 spellings',
    );
  });
});

describe('checkPlan', () => {
  it('reserves three capped runs', () => {
    const plan = checkPlan();
    expect(plan.runs).toBe(3);
    expect(plan.rows).toBe(150);
    expect(plan.reservedUsd).toBeCloseTo(0.48, 10);
    expect(plan.fits).toBe(true);
  });
});

describe('coverage', () => {
  it('counts merged jobs the halves cover', () => {
    const out = coverage(
      new Set(['a', 'b', 'c', 'd']),
      new Set(['a', 'b']),
      new Set(['c', 'x']),
    );
    expect(out).toEqual({
      merged: 4,
      covered: 3,
      share: 0.75,
      halvesOnly: 1,
      pass: false,
    });
  });

  it('passes at 95 percent', () => {
    const merged = new Set(Array.from({ length: 20 }, (_, i) => `j${i}`));
    const a = new Set([...merged].slice(0, 19));
    expect(coverage(merged, a, new Set()).pass).toBe(true);
  });
});

describe('inconclusive', () => {
  it('flags a full or empty merged run', () => {
    expect(inconclusive(150)).toBe('full');
    expect(inconclusive(0)).toBe('empty');
    expect(inconclusive(80)).toBeNull();
  });
});
