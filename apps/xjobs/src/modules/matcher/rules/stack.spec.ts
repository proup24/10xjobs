import type { Requirement, TechStack } from 'src/modules/processor/schema';
import { checkStack, type ImpliesMap } from './stack';
import { exampleProfile } from './fixtures.testing';

const skills = exampleProfile().skills;
const implies: ImpliesMap = new Map([['nestjs', ['nodejs', 'typescript']]]);

const req = (
  code: string | null,
  kind: Requirement['kind'],
  importance: number,
  group: string | null = null,
): Requirement => ({
  technology: { text: code ?? 'unknown tech', code },
  kind,
  importance,
  domain: null,
  years: null,
  quote: '',
  confidence: 'sure',
  group,
});
const stackOf = (
  requirements: Requirement[],
  groups: TechStack['groups'] = [],
): TechStack => ({ requirements, groups });
const run = (s: TechStack | null) => checkStack(s, skills, implies);

describe('checkStack', () => {
  it('passes with a weighted score', () => {
    const r = run(
      stackOf([req('python', 'main', 10), req('postgresql', 'must', 8)]),
    );
    expect(r.check.outcome).toBe('pass');
    expect(r.check.rule).toBe('stack');
    expect(r.score).toBe(0.856);
  });

  it('fails when no main requirement is covered and names it', () => {
    const r = run(stackOf([req('react', 'main', 9), req('nextjs', 'main', 9)]));
    expect(r.check.outcome).toBe('fail');
    expect(r.check.reason).toContain('react');
  });

  it('covers a group when min members are covered', () => {
    const s = stackOf(
      [req('python', 'main', 9, 'g'), req('ruby', 'main', 9, 'g')],
      [{ id: 'g', min: 1 }],
    );
    expect(run(s).check.outcome).toBe('pass');
  });

  it('leaves a min 2 group uncovered when only one member is', () => {
    const s = stackOf(
      [req('python', 'main', 9, 'g'), req('ruby', 'main', 9, 'g')],
      [{ id: 'g', min: 2 }],
    );
    expect(run(s).check.outcome).toBe('fail');
  });

  it('covers through implies at the implying mastery', () => {
    const r = run(stackOf([req('nodejs', 'must', 8)]));
    expect(r.check.outcome).toBe('pass');
    expect(r.score).toBe(0.9);
  });

  it('is unknown when every code is null', () => {
    const r = run(stackOf([req(null, 'main', 9), req(null, 'must', 6)]));
    expect(r.check.outcome).toBe('unknown');
    expect(r.score).toBeNull();
  });

  it('is unknown with only nice requirements', () => {
    const r = run(stackOf([req('python', 'nice', 3)]));
    expect(r.check.outcome).toBe('unknown');
    expect(r.score).toBeNull();
  });

  it('is unknown without a stack', () => {
    const r = run(null);
    expect(r.check.outcome).toBe('unknown');
    expect(r.score).toBeNull();
  });

  it('fails on the threshold when must requirements are uncovered', () => {
    const r = run(
      stackOf([
        req('python', 'main', 8),
        req('java', 'must', 9),
        req('kotlin', 'must', 9),
        req('scala', 'must', 9),
      ]),
    );
    expect(r.score).toBe(0.206);
    expect(r.check.outcome).toBe('fail');
    expect(r.check.reason).toContain('java');
  });

  it('lists covered nice requirements without scoring them', () => {
    const r = run(
      stackOf([req('python', 'main', 10), req('redis', 'nice', 3)]),
    );
    expect(r.score).toBe(0.9);
    expect((r.check.detail as { niceCovered: string[] }).niceCovered).toEqual([
      'redis',
    ]);
  });

  it('reports not comparable members', () => {
    const r = run(stackOf([req('python', 'main', 10), req(null, 'must', 5)]));
    expect(
      (r.check.detail as { notComparable: string[] }).notComparable,
    ).toEqual(['unknown tech']);
  });
});
