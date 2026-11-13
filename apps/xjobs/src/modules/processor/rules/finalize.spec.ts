import { describe, expect, it } from 'vitest';
import { fixtureDocumentV3 as fixtureDocument } from '../schema/fixture-v3.testing';
import { applyVerdicts, carryVerdicts } from './finalize';
import type { FieldVerdict } from './verify';

const v = (
  key: string,
  verdict: FieldVerdict['verdict'],
  generatorValue: string,
  jevPick: string | null,
  score: number | null = 0.9,
  round = 2,
): FieldVerdict =>
  ({
    key,
    verdict,
    score,
    jevPick,
    generatorValue,
    decidedBy: 'generator',
    round,
  }) as FieldVerdict;
const FINAL = { round: 2, final: true, regenerationInvalid: false };

describe('applyVerdicts', () => {
  it('confirmed seniority -> sure, score 0.9, verification.verdict confirmed', () => {
    const doc = fixtureDocument();
    doc.seniority.confidence = 'unsure';
    const out = applyVerdicts(
      doc,
      [v('seniority', 'confirmed', 'senior', 'senior')],
      FINAL,
    );
    expect(out.seniority).toMatchObject({
      confidence: 'sure',
      score: 0.9,
      value: 'senior',
      verification: { verdict: 'confirmed', rounds: 2 },
    });
    expect(out.verification.rounds).toBe(2);
  });

  it('rejected arrangement, final -> unstated, quote empty, openings unsure, dropped', () => {
    const doc = fixtureDocument();
    doc.arrangement.quote = 'fully remote';
    const out = applyVerdicts(
      doc,
      [v('arrangement', 'rejected', 'remote', 'onsite')],
      FINAL,
    );
    expect(out.arrangement).toMatchObject({
      value: 'unstated',
      quote: '',
      confidence: 'unsure',
    });
    expect(out.openings.every((o) => o.confidence === 'unsure')).toBe(true);
    expect(out.verification.dropped).toContainEqual({
      field: 'arrangement',
      generatorValue: 'remote',
      jevPick: 'onsite',
    });
  });

  it('rejected seniority final is not refilled from ingest', () => {
    const out = applyVerdicts(
      fixtureDocument(),
      [v('seniority', 'rejected', 'senior', 'junior')],
      FINAL,
    );
    expect(out.seniority.value).toBe('unstated');
  });

  it('confirmed unstated is not refilled', () => {
    const doc = fixtureDocument();
    doc.seniority.value = 'unstated';
    const out = applyVerdicts(
      doc,
      [v('seniority', 'confirmed', 'unstated', 'unstated')],
      FINAL,
    );
    expect(out.seniority.value).toBe('unstated');
    expect(out.seniority.confidence).toBe('sure');
  });

  it('rejected included junk flag removed; rejected omitted flag in missedJunkFlags', () => {
    const doc = fixtureDocument();
    doc.junkFlags.value = [{ code: 'vague', quote: '' }];
    const out = applyVerdicts(
      doc,
      [
        v('junk:vague', 'rejected', 'yes', 'no'),
        v('junk:spam', 'rejected', 'no', 'yes'),
      ],
      FINAL,
    );
    expect(out.junkFlags.value).toEqual([]);
    expect(out.verification.missedJunkFlags).toEqual(['spam']);
    expect(out.junkFlags.verification?.verdict).toBe('rejected');
  });

  it('Jev unstated on an included flag: rejected, removed at the end, not a missed flag', () => {
    const doc = fixtureDocument();
    doc.junkFlags.value = [{ code: 'vague', quote: '' }];
    const out = applyVerdicts(
      doc,
      [v('junk:vague', 'rejected', 'yes', 'unstated')],
      FINAL,
    );
    expect(out.junkFlags.value).toEqual([]);
    expect(out.verification.dropped.map((d) => d.field)).toEqual([
      'junk:vague',
    ]);
    expect(out.verification.missedJunkFlags).toEqual([]);
  });

  it('a rejected omitted flag is a missed flag only when Jev picked yes', () => {
    const out = applyVerdicts(
      fixtureDocument(),
      [
        v('junk:vague', 'rejected', 'no', 'unstated'),
        v('junk:spam', 'rejected', 'no', 'yes'),
      ],
      FINAL,
    );
    expect(out.verification.missedJunkFlags).toEqual(['spam']);
  });

  it('a carried verdict keeps the round it was given in', () => {
    const out = applyVerdicts(
      fixtureDocument(),
      [
        v('arrangement', 'confirmed', 'remote', 'remote', 0.9, 1),
        v('seniority', 'confirmed', 'senior', 'senior', 0.9, 2),
        v('junk:vague', 'confirmed', 'no', 'no', 0.9, 1),
        v('junk:spam', 'confirmed', 'no', 'no', 0.9, 2),
      ],
      FINAL,
    );
    expect(out.arrangement.verification?.rounds).toBe(1);
    expect(out.seniority.verification?.rounds).toBe(2);
    // The junk envelope was settled when its last flag was judged.
    expect(out.junkFlags.verification?.rounds).toBe(2);
    expect(out.verification.rounds).toBe(2);
  });

  it('final rejections of roleKind, engineering and sponsorship use the mapped nulls', () => {
    const out = applyVerdicts(
      fixtureDocument(),
      [
        v('roleKind', 'rejected', 'backend', 'data'),
        v('isSoftwareEngineeringRole', 'rejected', 'yes', 'no'),
        v('sponsorshipOffered', 'rejected', 'unstated', 'yes'),
      ],
      FINAL,
    );
    expect(out.position.value).toEqual({
      roleKind: 'unstated',
      title: 'Backend Engineer',
    });
    expect(out.position.confidence).toBe('unsure');
    expect(out.isSoftwareEngineeringRole.value).toBeNull();
    expect(out.workAuthorization.value?.sponsorship).toBe('unstated');
    expect(out.workAuthorization.confidence).toBe('unsure');
  });

  it('non-final rejection only records the verdict', () => {
    const doc = fixtureDocument();
    const out = applyVerdicts(
      doc,
      [v('arrangement', 'rejected', 'remote', 'onsite')],
      { round: 1, final: false, regenerationInvalid: false },
    );
    expect(out.arrangement.value).toBe('remote');
    expect(out.arrangement.confidence).toBe('sure');
    expect(out.openings[0].confidence).toBe('sure');
    expect(out.verification.dropped).toEqual([]);
    expect(out.arrangement.verification?.verdict).toBe('rejected');
  });
});

describe('carryVerdicts', () => {
  it('changed confirmed field is re-verified; unchanged confirmed is kept', () => {
    const previous = [
      v('seniority', 'confirmed', 'senior', 'senior'),
      v('arrangement', 'confirmed', 'remote', 'remote'),
      v('engagement', 'unconfirmed', 'employee', null, null),
    ];
    const prev = {
      seniority: 'senior',
      arrangement: 'remote',
      engagement: 'employee',
    } as never;
    const next = {
      seniority: 'mid',
      arrangement: 'remote',
      engagement: 'employee',
    } as never;
    const { kept, toAsk } = carryVerdicts(previous, prev, next);
    expect(toAsk.has('seniority' as never)).toBe(true);
    expect(toAsk.has('engagement' as never)).toBe(true);
    expect(kept.map((k) => k.key)).toEqual(['arrangement']);
  });
});
