import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { modelOutputSchema } from '../schema/model-output';
import { seedOptions } from './options.testing';
import { buildVerificationQuestions } from './questions';

describe('buildVerificationQuestions', () => {
  const options = seedOptions();
  const questions = buildVerificationQuestions(options);
  const opts = (key: string) => {
    const q = questions.find((x) => x.key === key);
    if (q?.kind !== 'choice') throw new Error(`${key} is not a choice`);
    return q.options;
  };

  it('lists the keys in spec order', () => {
    const keys = questions.map((q) => q.key);
    expect(keys.slice(0, 6)).toEqual([
      'arrangement',
      'seniority',
      'roleKind',
      'contractType',
      'engagement',
      'isSoftwareEngineeringRole',
    ]);
    expect(keys.at(-1)).toBe('sponsorshipOffered');
  });

  it('every question is a choice', () => {
    expect(questions.every((q) => q.kind === 'choice')).toBe(true);
  });

  it('booleans, junk flags and sponsorship offer yes, no, unstated', () => {
    expect(opts('isSoftwareEngineeringRole')).toEqual([
      'yes',
      'no',
      'unstated',
    ]);
    expect(opts('sponsorshipOffered')).toEqual(['yes', 'no', 'unstated']);
    for (const c of options.junkFlags)
      expect(opts(`junk:${c}`)).toEqual(['yes', 'no', 'unstated']);
  });

  it('adds unstated exactly once', () => {
    expect(opts('engagement').filter((o) => o === 'unstated')).toHaveLength(1);
    const withIt = buildVerificationQuestions({
      ...options,
      engagements: ['employee', 'unstated'],
    }).find((q) => q.key === 'engagement');
    expect(
      withIt?.kind === 'choice' &&
        withIt.options.filter((o) => o === 'unstated'),
    ).toHaveLength(1);
  });

  it('builds only the requested keys', () => {
    const only = buildVerificationQuestions(options, new Set(['seniority']));
    expect(only.map((q) => q.key)).toEqual(['seniority']);
  });

  it('gives every question a short instruction', () => {
    for (const q of questions)
      expect(q.instructions.length).toBeGreaterThan(10);
  });

  it('schema enums equal verification options', () => {
    const json = z.toJSONSchema(modelOutputSchema(options), {
      io: 'input',
    }) as {
      properties: Record<string, unknown>;
    };
    const enumsAt = (node: unknown): string[] => {
      if (!node || typeof node !== 'object') return [];
      const n = node as Record<string, unknown>;
      if (Array.isArray(n.enum)) return n.enum as string[];
      return Object.values(n).flatMap(enumsAt);
    };
    const valueOf = (field: string) =>
      (json.properties[field] as { properties: { value: unknown } }).properties
        .value;
    const fields: Record<string, unknown> = {
      arrangement: valueOf('arrangement'),
      seniority: valueOf('seniority'),
      contractType: valueOf('contractType'),
      engagement: valueOf('engagement'),
      roleKind: (
        valueOf('position') as never as {
          anyOf: { properties?: { roleKind: unknown } }[];
        }
      ).anyOf.find((a) => a.properties)?.properties?.roleKind,
    };
    for (const [key, node] of Object.entries(fields)) {
      const expected = new Set([...enumsAt(node), 'unstated']);
      expect(new Set(opts(key)), key).toEqual(expected);
    }
  });
});
