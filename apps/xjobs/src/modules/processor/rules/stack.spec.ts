import { describe, expect, it } from 'vitest';
import type { Requirement, TechStack } from '../schema/shared';
import { stackErrors } from './stack';

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
