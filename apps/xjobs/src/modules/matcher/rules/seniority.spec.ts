import { checkSeniority } from './seniority';
import { exampleProfile, jobDoc } from './fixtures.testing';

const profile = exampleProfile();
const doc = (seniority: string | null, min: number | null = null) =>
  jobDoc((d) => {
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
});
