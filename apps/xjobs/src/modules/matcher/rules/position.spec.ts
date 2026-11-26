import { checkPosition } from './position';
import { exampleProfile, factsDoc } from './fixtures.testing';

const profile = exampleProfile();
const withRole = (roleKind: string | null, isSwe = true) =>
  factsDoc((d) => {
    d.position.value = roleKind === null ? null : { roleKind, title: 't' };
    d.isSoftwareEngineeringRole.value = isSwe;
  });

describe('checkPosition', () => {
  it('fails a non software engineering role first', () => {
    const c = checkPosition(withRole('backend_engineer', false), profile);
    expect(c.outcome).toBe('fail');
  });
  it('passes the same code', () => {
    expect(checkPosition(withRole('backend_engineer'), profile).outcome).toBe(
      'pass',
    );
  });
  it.each([null, 'unstated'])('is unknown for %s', (v) => {
    expect(checkPosition(withRole(v), profile).outcome).toBe('unknown');
  });
  it('fails another code and names both', () => {
    const c = checkPosition(withRole('fullstack_engineer'), profile);
    expect(c.outcome).toBe('fail');
    expect(c.reason).toContain('fullstack_engineer');
    expect(c.reason).toContain('backend_engineer');
  });
  it('sets jobValue and profileValue on every check', () => {
    for (const d of [
      withRole('backend_engineer', false),
      withRole('backend_engineer'),
      withRole(null),
      withRole('fullstack_engineer'),
    ]) {
      const c = checkPosition(d, profile);
      expect(c.rule).toBe('position');
      expect(c.profileValue).toBe('backend_engineer');
      expect('jobValue' in c).toBe(true);
    }
    expect(
      checkPosition(withRole('fullstack_engineer'), profile).jobValue,
    ).toBe('fullstack_engineer');
  });

  describe('tech_lead', () => {
    const lead = {
      ...profile,
      position: 'tech_lead',
      seniorities: ['lead'],
    };
    const leadRole = (roleKind: string, seniority: string) => {
      const d = withRole(roleKind);
      d.seniority.value = seniority;
      return d;
    };
    it('tech_lead passes on lead fullstack_engineer', () => {
      const c = checkPosition(leadRole('fullstack_engineer', 'lead'), lead);
      expect(c).toMatchObject({
        outcome: 'pass',
        reason: 'lead-level fullstack_engineer counts for tech_lead',
        unsure: false,
      });
    });
    it('tech_lead still fails on senior fullstack_engineer', () => {
      expect(
        checkPosition(leadRole('fullstack_engineer', 'senior'), lead).outcome,
      ).toBe('fail');
    });
    it('backend_engineer still fails on lead fullstack_engineer', () => {
      expect(
        checkPosition(leadRole('fullstack_engineer', 'lead'), profile).outcome,
      ).toBe('fail');
    });
    it.each(['other', 'engineering_manager'])(
      'tech_lead fails on lead %s',
      (k) => {
        expect(checkPosition(leadRole(k, 'lead'), lead).outcome).toBe('fail');
      },
    );
    it('a tech_lead profile without lead in its seniorities still fails position', () => {
      const p = { ...lead, seniorities: ['senior'] };
      expect(
        checkPosition(leadRole('fullstack_engineer', 'lead'), p).outcome,
      ).toBe('fail');
    });
    it('a null isSoftwareEngineeringRole passes unsure on that flag', () => {
      const d = leadRole('fullstack_engineer', 'lead');
      d.isSoftwareEngineeringRole.value = null;
      expect(checkPosition(d, lead)).toMatchObject({
        outcome: 'pass',
        unsure: true,
        unsureField: 'isSoftwareEngineeringRole',
      });
    });
    it('an unsure position on a lead role passes unsure on position', () => {
      const d = leadRole('fullstack_engineer', 'lead');
      d.position.confidence = 'unsure';
      expect(checkPosition(d, lead)).toMatchObject({
        outcome: 'pass',
        unsure: true,
        unsureField: 'position',
      });
    });
    it('an unsure lead seniority makes the pass unsure on seniority', () => {
      const d = leadRole('fullstack_engineer', 'lead');
      d.seniority.confidence = 'unsure';
      expect(checkPosition(d, lead)).toMatchObject({
        outcome: 'pass',
        unsure: true,
        unsureField: 'seniority',
      });
    });
  });

  describe('unsure', () => {
    it('a failing role resting on an unsure position is unsure, on that field', () => {
      const d = withRole('fullstack_engineer');
      d.position.confidence = 'unsure';
      const c = checkPosition(d, profile);
      expect(c).toMatchObject({
        outcome: 'fail',
        unsure: true,
        unsureField: 'position',
      });
    });
    it('a non engineering role resting on an unsure flag is unsure, on that field', () => {
      const d = withRole('backend_engineer', false);
      d.isSoftwareEngineeringRole.confidence = 'unsure';
      expect(checkPosition(d, profile)).toMatchObject({
        outcome: 'fail',
        unsure: true,
        unsureField: 'isSoftwareEngineeringRole',
      });
    });
    it('a non engineering role is sure when only the position is unsure', () => {
      const d = withRole('backend_engineer', false);
      d.position.confidence = 'unsure';
      expect(checkPosition(d, profile)).toMatchObject({
        outcome: 'fail',
        unsure: false,
        unsureField: null,
      });
    });
    describe('a non engineering role on an unsure flag fails as if the flag were true', () => {
      const notSwe = (roleKind: string | null) => {
        const d = withRole(roleKind, false);
        d.isSoftwareEngineeringRole.confidence = 'unsure';
        return d;
      };
      it('another sure role is a sure failure', () => {
        expect(
          checkPosition(notSwe('fullstack_engineer'), profile),
        ).toMatchObject({ outcome: 'fail', unsure: false, unsureField: null });
      });
      it('another unsure role is unsure, on the position', () => {
        const d = notSwe('fullstack_engineer');
        d.position.confidence = 'unsure';
        expect(checkPosition(d, profile)).toMatchObject({
          outcome: 'fail',
          unsure: true,
          unsureField: 'position',
        });
      });
      it.each([null, 'unstated'])(
        'role %s is unsure on the flag, but sure when the stack is unknown too',
        (v) => {
          expect(checkPosition(notSwe(v), profile)).toMatchObject({
            outcome: 'fail',
            unsure: true,
            unsureField: 'isSoftwareEngineeringRole',
          });
          expect(checkPosition(notSwe(v), profile, true)).toMatchObject({
            outcome: 'fail',
            unsure: false,
            unsureField: null,
          });
        },
      );
    });
    it('a sure failure is not unsure', () => {
      expect(
        checkPosition(withRole('fullstack_engineer'), profile),
      ).toMatchObject({ outcome: 'fail', unsure: false, unsureField: null });
    });
  });
});
