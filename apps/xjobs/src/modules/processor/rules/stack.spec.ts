import { describe, expect, it } from 'vitest';
import type { Requirement, TechStack } from '../schema/shared';
import { mergeDuplicateRequirements, stackErrors } from './stack';

const req = (code: string, patch: Partial<Requirement> = {}): Requirement => ({
  technology: { text: code, code },
  kind: 'must',
  importance: 6,
  domain: null,
  years: null,
  quote: '',
  confidence: 'sure',
  group: null,
  ...patch,
});

const stack = (
  requirements: Requirement[],
  groups: TechStack['groups'] = [],
): TechStack => ({ requirements, groups });

describe('stackErrors', () => {
  it('accepts Python|TypeScript|Go in group g1 min 1', () => {
    const s = stack(
      ['python', 'typescript', 'go'].map((c) => req(c, { group: 'g1' })),
      [{ id: 'g1', min: 1 }],
    );
    expect(stackErrors(s)).toEqual([]);
  });

  it('rejects a group that references an unknown id', () => {
    const errors = stackErrors(stack([req('python', { group: 'nope' })]));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^techStack\.value\.requirements\.0\.group: /);
  });

  it('rejects a group with one member', () => {
    const s = stack([req('python', { group: 'g1' })], [{ id: 'g1', min: 1 }]);
    expect(stackErrors(s)).not.toEqual([]);
  });

  it('rejects a group min 3 with 2 members', () => {
    const s = stack(
      [req('python', { group: 'g1' }), req('go', { group: 'g1' })],
      [{ id: 'g1', min: 3 }],
    );
    expect(stackErrors(s)).not.toEqual([]);
  });

  it('rejects group members with different kinds', () => {
    const s = stack(
      [
        req('python', { group: 'g1' }),
        req('go', { group: 'g1', kind: 'nice', importance: 3 }),
      ],
      [{ id: 'g1', min: 1 }],
    );
    expect(stackErrors(s)).not.toEqual([]);
  });

  it('rejects a duplicate (code, domain)', () => {
    const s = stack([
      req('python', { domain: 'backend' }),
      req('python', { domain: 'backend' }),
    ]);
    expect(stackErrors(s)).not.toEqual([]);
  });

  it('accepts the same code with different domains', () => {
    const s = stack([
      req('python', { domain: 'backend' }),
      req('python', { domain: 'data' }),
    ]);
    expect(stackErrors(s)).toEqual([]);
  });

  it('rejects a nice requirement with importance 6', () => {
    const s = stack([req('rust', { kind: 'nice', importance: 6 })]);
    expect(stackErrors(s)).not.toEqual([]);
  });

  it('rejects a main requirement with importance 7', () => {
    const s = stack([req('rust', { kind: 'main', importance: 7 })]);
    expect(stackErrors(s)).not.toEqual([]);
  });

  it('accepts a must requirement with importance 5 and with 9', () => {
    expect(stackErrors(stack([req('rust', { importance: 5 })]))).toEqual([]);
    expect(stackErrors(stack([req('rust', { importance: 9 })]))).toEqual([]);
  });

  it('rejects years { min: 5, max: 3 }', () => {
    const s = stack([req('rust', { years: { min: 5, max: 3 } })]);
    expect(stackErrors(s)).not.toEqual([]);
  });

  it('accepts years { min: 3, max: null }', () => {
    const s = stack([req('rust', { years: { min: 3, max: null } })]);
    expect(stackErrors(s)).toEqual([]);
  });
});

describe('mergeDuplicateRequirements', () => {
  it('returns an equal stack when there are no duplicates', () => {
    const s = stack([req('aws'), req('gcp')]);
    const result = mergeDuplicateRequirements(s);
    expect(result.stack).toEqual(s);
    expect(result.dropped).toEqual([]);
  });

  it('keeps the stronger kind of two standalone copies', () => {
    const result = mergeDuplicateRequirements(
      stack([
        req('dotnet', { kind: 'nice', importance: 3, domain: 'backend' }),
        req('dotnet', { kind: 'must', importance: 6, domain: 'backend' }),
      ]),
    );
    expect(result.stack.requirements).toHaveLength(1);
    expect(result.stack.requirements[0].kind).toBe('must');
    expect(result.dropped).toEqual(['dotnet']);
    expect(stackErrors(result.stack)).toEqual([]);
  });

  it('keeps the higher importance on equal kinds', () => {
    const result = mergeDuplicateRequirements(
      stack([
        req('dotnet', { importance: 5 }),
        req('dotnet', { importance: 8 }),
      ]),
    );
    expect(result.stack.requirements).toHaveLength(1);
    expect(result.stack.requirements[0].importance).toBe(8);
    expect(stackErrors(result.stack)).toEqual([]);
  });

  it('keeps the first on a full tie', () => {
    const result = mergeDuplicateRequirements(
      stack([req('dotnet', { quote: 'a' }), req('dotnet', { quote: 'b' })]),
    );
    expect(result.stack.requirements).toHaveLength(1);
    expect(result.stack.requirements[0].quote).toBe('a');
    expect(stackErrors(result.stack)).toEqual([]);
  });

  it('keeps three standalone copies as one', () => {
    const result = mergeDuplicateRequirements(
      stack([req('css'), req('css'), req('css')]),
    );
    expect(result.stack.requirements).toHaveLength(1);
    expect(result.dropped).toHaveLength(2);
    expect(stackErrors(result.stack)).toEqual([]);
  });

  it('drops the later copy inside one group and keeps the group', () => {
    const result = mergeDuplicateRequirements(
      stack(
        ['python', 'go', 'go'].map((c) => req(c, { group: 'g1' })),
        [{ id: 'g1', min: 1 }],
      ),
    );
    expect(result.stack.requirements).toHaveLength(2);
    expect(result.stack.groups).toEqual([{ id: 'g1', min: 1 }]);
    expect(stackErrors(result.stack)).toEqual([]);
  });

  it('dissolves a group left with one member', () => {
    const result = mergeDuplicateRequirements(
      stack(
        ['aws', 'aws'].map((c) => req(c, { group: 'g1' })),
        [{ id: 'g1', min: 1 }],
      ),
    );
    expect(result.stack.groups).toEqual([]);
    expect(result.stack.requirements).toHaveLength(1);
    expect(result.stack.requirements[0].group).toBeNull();
    expect(stackErrors(result.stack)).toEqual([]);
  });

  it('lowers a group min above its member count', () => {
    const result = mergeDuplicateRequirements(
      stack(
        ['a', 'b', 'b'].map((c) => req(c, { group: 'g1' })),
        [{ id: 'g1', min: 3 }],
      ),
    );
    expect(result.stack.groups).toEqual([{ id: 'g1', min: 2 }]);
    expect(stackErrors(result.stack)).toEqual([]);
  });

  it('leaves a standalone and a grouped copy alone', () => {
    const s = stack(
      [req('aws'), req('aws', { group: 'g1' }), req('gcp', { group: 'g1' })],
      [{ id: 'g1', min: 1 }],
    );
    const result = mergeDuplicateRequirements(s);
    expect(result.stack).toEqual(s);
    expect(result.dropped).toEqual([]);
  });

  it('leaves copies in two different groups alone', () => {
    const s = stack(
      [
        req('aws', { group: 'g1' }),
        req('gcp', { group: 'g1' }),
        req('aws', { group: 'g2' }),
        req('azure', { group: 'g2' }),
      ],
      [
        { id: 'g1', min: 1 },
        { id: 'g2', min: 1 },
      ],
    );
    const result = mergeDuplicateRequirements(s);
    expect(result.stack).toEqual(s);
    expect(result.dropped).toEqual([]);
  });

  it('merges standalone copies but leaves the grouped one', () => {
    const result = mergeDuplicateRequirements(
      stack(
        [
          req('aws'),
          req('aws'),
          req('aws', { group: 'g1' }),
          req('gcp', { group: 'g1' }),
        ],
        [{ id: 'g1', min: 1 }],
      ),
    );
    expect(result.stack.requirements).toHaveLength(3);
    expect(
      result.stack.requirements.filter((r) => r.group === null),
    ).toHaveLength(1);
    expect(result.stack.groups).toEqual([{ id: 'g1', min: 1 }]);
    expect(stackErrors(result.stack)).toHaveLength(1);
  });

  it('keeps the same code in different domains', () => {
    const s = stack([
      req('aws', { domain: 'backend' }),
      req('aws', { domain: 'frontend' }),
    ]);
    const result = mergeDuplicateRequirements(s);
    expect(result.stack).toEqual(s);
    expect(result.dropped).toEqual([]);
  });

  it('matches null-code terms by trimmed lower-case text', () => {
    const result = mergeDuplicateRequirements(
      stack([
        req('x', { technology: { text: ' Foo ', code: null } }),
        req('x', { technology: { text: 'foo', code: null } }),
      ]),
    );
    expect(result.stack.requirements).toHaveLength(1);
    expect(result.dropped).toEqual(['text:foo']);
    expect(stackErrors(result.stack)).toEqual([]);
  });

  it('does not mutate its input', () => {
    const s = stack(
      [
        req('aws', { group: 'g1' }),
        req('aws', { group: 'g1' }),
        req('css'),
        req('css'),
      ],
      [{ id: 'g1', min: 2 }],
    );
    const before = structuredClone(s);
    mergeDuplicateRequirements(s);
    expect(s).toEqual(before);
  });
});
