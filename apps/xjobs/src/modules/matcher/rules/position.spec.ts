import { checkPosition } from './position';
import { exampleProfile, jobDoc } from './fixtures.testing';

const profile = exampleProfile();
const withRole = (roleKind: string | null, isSwe = true) =>
  jobDoc((d) => {
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
});
