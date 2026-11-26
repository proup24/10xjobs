import { fixtureHiringPost } from 'src/modules/processor/schema/fixture-post.testing';
import { parseRoleLinksArgs, roleLinks, type RoleRow } from './role-links';

const doc = fixtureHiringPost();
doc.roles[0].howToApply.kinds = ['linkedin_job'];
doc.roles[0].howToApply.email = null;
doc.roles[0].howToApply.emailQuote = '';
doc.roles[0].howToApply.links = [
  'https://www.linkedin.com/jobs/view/4490421090/?trk=x',
];
const original = '2026-11-10T08:00:00.000Z';
const shared = new Date('2026-11-20T10:00:00.000Z');

const role = (over: Partial<RoleRow> = {}): RoleRow => ({
  id: 'r1',
  roleKey: 'backend-engineer',
  linkKeys: [],
  postedAt: shared,
  parentPostedAt: shared,
  postSources: {
    sources: [
      { postedAt: shared.toISOString(), original: { postedAt: original } },
    ],
  },
  postDocument: doc,
  ...over,
});

describe('roleLinks', () => {
  it("fills a role's linkKeys and the original's postedAt", async () => {
    const update = vi.fn(async () => undefined);
    const result = await roleLinks({ listRoles: async () => [role()], update });
    expect(result).toEqual({ total: 1, changed: 1 });
    expect(update).toHaveBeenCalledWith('r1', {
      linkKeys: ['linkedin-job:4490421090'],
      postedAt: new Date(original),
    });
  });

  it('leaves a role that is already right, and one whose post no longer holds it', async () => {
    const update = vi.fn(async () => undefined);
    const result = await roleLinks({
      listRoles: async () => [
        role({
          linkKeys: ['linkedin-job:4490421090'],
          postedAt: new Date(original),
        }),
        role({ id: 'r2', roleKey: 'gone', postedAt: new Date(original) }),
        role({ id: 'r3', postDocument: null, postedAt: new Date(original) }),
      ],
      update,
    });
    expect(result).toEqual({ total: 3, changed: 0 });
    expect(update).not.toHaveBeenCalled();
  });

  it('--dry-run counts but writes nothing', async () => {
    const update = vi.fn(async () => undefined);
    const result = await roleLinks(
      { listRoles: async () => [role()], update },
      { dryRun: true },
    );
    expect(result.changed).toBe(1);
    expect(update).not.toHaveBeenCalled();
  });
});

describe('parseRoleLinksArgs', () => {
  it('reads --dry-run and refuses anything else', () => {
    expect(parseRoleLinksArgs(['--', '--dry-run'])).toEqual({ dryRun: true });
    expect(parseRoleLinksArgs([])).toEqual({ dryRun: false });
    expect(() => parseRoleLinksArgs(['--x'])).toThrow();
  });
});
