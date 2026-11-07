import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { DecisionAnswer } from '../models/types';
import { fixtureDocument } from '../schema/fixture.testing';
import { seedOptions } from './options.testing';
import { generatorAnswers, judge } from './verify';

const MODEL = 'typesafe/jev-1.14';
const gen = { seniority: 'senior', 'junk:vague': 'no' } as never;
const ans = (key: string, value: DecisionAnswer['value'], score: number) =>
  ({ key, value, score }) as DecisionAnswer;

describe('judge', () => {
  it('same pick, score 0.9, threshold 0.8 -> confirmed', () => {
    const [v] = judge(
      { seniority: 'senior' } as never,
      [ans('seniority', 'senior', 0.9)],
      MODEL,
    );
    expect(v).toMatchObject({
      verdict: 'confirmed',
      score: 0.9,
      jevPick: 'senior',
    });
  });

  it('different pick, score 0.9 -> rejected, jevPick set', () => {
    const [v] = judge(
      { seniority: 'senior' } as never,
      [ans('seniority', 'junior', 0.9)],
      MODEL,
    );
    expect(v).toMatchObject({
      verdict: 'rejected',
      jevPick: 'junior',
      generatorValue: 'senior',
    });
  });

  it('same pick, score 0.5 -> unconfirmed; different pick, score 0.5 -> unconfirmed', () => {
    const g = { seniority: 'senior' } as never;
    expect(judge(g, [ans('seniority', 'senior', 0.5)], MODEL)[0].verdict).toBe(
      'unconfirmed',
    );
    expect(judge(g, [ans('seniority', 'junior', 0.5)], MODEL)[0].verdict).toBe(
      'unconfirmed',
    );
  });

  it('missing answer -> unconfirmed, score null', () => {
    expect(judge(gen, [], MODEL)[0]).toMatchObject({
      verdict: 'unconfirmed',
      score: null,
      jevPick: null,
    });
  });

  it('null value -> unconfirmed, score null', () => {
    expect(judge(gen, [ans('seniority', null, 0.9)], MODEL)[0]).toMatchObject({
      verdict: 'unconfirmed',
      score: null,
    });
  });

  it('unknown model -> all unconfirmed, warned once', () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const answers = [
      ans('seniority', 'senior', 0.99),
      ans('junk:vague', 'no', 0.99),
    ];
    const a = judge(gen, answers, 'some/unknown-model');
    judge(gen, answers, 'some/unknown-model');
    expect(a.every((v) => v.verdict === 'unconfirmed')).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('generator null compared as unstated: Jev unstated 0.9 -> confirmed', () => {
    const [v] = judge(
      { seniority: 'unstated' } as never,
      [ans('seniority', 'unstated', 0.9)],
      MODEL,
    );
    expect(v.verdict).toBe('confirmed');
    // A confirmed unstated is not refilled: covered by Task 6's finalize test.
  });

  it('junk flag present, Jev no 0.9 -> rejected; absent, Jev yes 0.9 -> rejected', () => {
    expect(
      judge(
        { 'junk:vague': 'yes' } as never,
        [ans('junk:vague', 'no', 0.9)],
        MODEL,
      )[0].verdict,
    ).toBe('rejected');
    expect(
      judge(
        { 'junk:vague': 'no' } as never,
        [ans('junk:vague', 'yes', 0.9)],
        MODEL,
      )[0].verdict,
    ).toBe('rejected');
  });

  it('boolean answers compare as yes/no', () => {
    expect(
      judge(
        { isSoftwareEngineeringRole: 'yes' } as never,
        [ans('isSoftwareEngineeringRole', true, 0.9)],
        MODEL,
      )[0].verdict,
    ).toBe('confirmed');
  });
});

describe('generatorAnswers', () => {
  const options = seedOptions();
  it('maps the document to option strings', () => {
    const doc = fixtureDocument();
    doc.isSoftwareEngineeringRole.value = null;
    doc.junkFlags.value = [{ code: options.junkFlags[0], quote: 'q' }];
    const out = generatorAnswers(doc, options);
    expect(out.isSoftwareEngineeringRole).toBe('unstated');
    expect(out.roleKind).toBe(doc.position.value?.roleKind ?? 'unstated');
    expect(out[`junk:${options.junkFlags[0]}`]).toBe('yes');
    expect(out[`junk:${options.junkFlags[1]}`]).toBe('no');
    expect(out.sponsorshipOffered).toBe(
      doc.workAuthorization.value?.sponsorship ?? 'unstated',
    );
  });
});
