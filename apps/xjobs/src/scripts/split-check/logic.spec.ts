import { linkedinKeyword } from 'src/modules/queries/channels/linkedin_keyword';
import {
  RUN_CAP_USD,
  checkPlan,
  coverage,
  halfKeywords,
  inconclusive,
  searchParams,
  pickGroup,
  runFailure,
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

  it('halves by keyword unit: one user keeps its levels in one half', () => {
    const g = group('k', 50, [
      member('a3', 'h1', ['go']),
      member('b3', 'h2', ['java']),
      member('a4', 'h3', ['go']),
      member('c3', 'h4', ['rust']),
      member('b4', 'h5', ['java']),
    ]);
    const out = halfKeywords(g);
    expect(out.by).toBe('members');
    expect(out.halves[0]).toBe(linkedinKeyword(['engineer'], ['go', 'java']));
    expect(out.halves[1]).toBe(linkedinKeyword(['engineer'], ['rust']));
  });

  it('halves the spellings of one keyword unit, whatever its levels', () => {
    const g = group('k', 50, [
      member('a3', 'h1', ['rust', 'go', 'java']),
      member('a4', 'h2', ['rust', 'go', 'java']),
    ]);
    const out = halfKeywords(g);
    expect(out.by).toBe('spellings');
    expect(out.merged).toBe(
      linkedinKeyword(['engineer'], ['go', 'java', 'rust']),
    );
    expect(out.halves[0]).toBe(linkedinKeyword(['engineer'], ['go', 'java']));
    expect(out.halves[1]).toBe(linkedinKeyword(['engineer'], ['rust']));
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

describe('searchParams', () => {
  it('searches the union of the members levels, as the collector does', () => {
    const at = (id: string, experienceLevel?: string) => ({
      id,
      hash: id,
      params: {
        location: 'Germany',
        workType: '2',
        roleWords: ['engineer'],
        spellings: ['go'],
        ...(experienceLevel === undefined ? {} : { experienceLevel }),
      },
    });
    expect(
      searchParams(group('k', 5, [at('a', '4'), at('b', '3')])),
    ).toMatchObject({
      location: 'Germany',
      workType: '2',
      experienceLevel: '3,4',
    });
    expect(
      searchParams(group('k', 5, [at('a', '4'), at('b')])).experienceLevel,
    ).toBeUndefined();
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
    expect(inconclusive(150, 0.05, 'merged')).toBe('full');
    expect(inconclusive(0, 0.05, 'merged')).toBe('empty');
    expect(inconclusive(80, 0.05, 'merged')).toBeNull();
  });

  it('flags a half that returned the full row limit', () => {
    expect(inconclusive(150, 0.05, 'half')).toBe('full');
  });

  it('accepts an empty half', () => {
    expect(inconclusive(0, 0.05, 'half')).toBeNull();
  });

  it('flags a run that spent its cost cap, whatever it returned', () => {
    expect(inconclusive(80, RUN_CAP_USD, 'merged')).toBe('capped');
    expect(inconclusive(80, RUN_CAP_USD + 0.01, 'half')).toBe('capped');
    expect(inconclusive(80, RUN_CAP_USD - 0.01, 'half')).toBeNull();
  });

  it('judges fullness on the item count, so a duplicate id still counts as full', () => {
    const items = Array.from({ length: 150 }, (_, i) => ({
      id: String(Math.min(i, 148)),
    }));
    expect(new Set(items.map((i) => i.id)).size).toBe(149);
    expect(inconclusive(items.length, 0.05, 'merged')).toBe('full');
  });
});

describe('runFailure', () => {
  it('accepts only a succeeded run', () => {
    expect(runFailure('r1', 'SUCCEEDED', 0.1)).toBeNull();
  });

  it('names the run, its status and the spend so far', () => {
    const message = runFailure('r1', 'TIMED-OUT', 0.123);
    expect(message).toContain('r1');
    expect(message).toContain('TIMED-OUT');
    expect(message).toContain('$0.123');
    expect(runFailure('r2', 'RUNNING', 0)).toContain('RUNNING');
  });
});
