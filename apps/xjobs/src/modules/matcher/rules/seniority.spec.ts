import { checkSeniority } from './seniority';
import { exampleProfile, factsDoc } from './fixtures.testing';

const profile = exampleProfile();
const doc = (seniority: string | null, min: number | null = null) =>
  factsDoc((d) => {
    d.seniority.value = seniority;
    d.yearsRequired.value = min === null ? null : { min, max: null };
  });

describe('checkSeniority', () => {
  it('passes a seniority in the set', () => {
    expect(checkSeniority(doc('senior'), profile).outcome).toBe('pass');
  });
  it('fails a seniority outside the set', () => {
    const c = checkSeniority(doc('junior'), profile);
    expect(c.outcome).toBe('fail');
    expect(c.jobValue).toBe('junior');
    expect(c.profileValue).toEqual(['senior']);
  });
  it('fails unstated seniority asking for 8 years', () => {
    const c = checkSeniority(doc('unstated', 8), profile);
    expect(c.outcome).toBe('fail');
    expect(c.reason).toContain('8');
    expect(c.reason).toContain('5');
  });
  it('is unknown at 7 years (within the margin)', () => {
    expect(checkSeniority(doc('unstated', 7), profile).outcome).toBe('unknown');
  });
  it('never passes on years alone', () => {
    expect(checkSeniority(doc('unstated', 3), profile).outcome).toBe('unknown');
  });
  it('is unknown with no seniority and no years', () => {
    const c = checkSeniority(doc(null), profile);
    expect(c.outcome).toBe('unknown');
    expect('jobValue' in c).toBe(true);
  });

  describe('unsure', () => {
    it('a failing seniority resting on an unsure seniority is unsure', () => {
      const d = doc('junior');
      d.seniority.confidence = 'unsure';
      expect(checkSeniority(d, profile)).toMatchObject({
        outcome: 'fail',
        unsure: true,
        unsureField: 'seniority',
      });
    });
    it('the years fallback resting on unsure years is unsure, on yearsRequired', () => {
      const d = doc('unstated', 8);
      d.yearsRequired.confidence = 'unsure';
      expect(checkSeniority(d, profile)).toMatchObject({
        outcome: 'fail',
        unsure: true,
        unsureField: 'yearsRequired',
      });
    });
    it('the years fallback is sure when only the seniority is unsure', () => {
      const d = doc('unstated', 8);
      d.seniority.confidence = 'unsure';
      expect(checkSeniority(d, profile)).toMatchObject({
        outcome: 'fail',
        unsure: false,
      });
    });
    it('a sure failure is not unsure', () => {
      expect(checkSeniority(doc('junior'), profile)).toMatchObject({
        outcome: 'fail',
        unsure: false,
        unsureField: null,
      });
    });
  });
});
