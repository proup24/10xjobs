import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cleanupDetailedJobs,
  linkedinJobId,
  seedKeyedListing,
  seedLinkedRole,
} from './support/fixtures.js';
import { withCatalog } from './support/pg.js';
import {
  cleanupTestUsers,
  createTestUser,
  type TestUser,
} from './support/test-users.js';

// Detailed jobs go before the users.
afterAll(async () => {
  await cleanupDetailedJobs();
  await cleanupTestUsers();
});

/** The job's linked group, sorted, read the way match_details reads it (as the owner). */
const groupOf = (jobId: string): Promise<string[]> =>
  withCatalog(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      'SELECT public.job_link_group($1) AS id',
      [jobId],
    );
    return rows.map((r) => r.id).sort();
  });

const sorted = (...ids: string[]) => [...ids].sort();

describe('job_link_group', () => {
  it('a role linking linkedin-job:<id> finds the listing keyed url:… through its harvestapi source id:<id>', async () => {
    const id = linkedinJobId();
    const listing = await seedKeyedListing({
      jobKey: `url:https://careers.acme.example/jobs/${id}`,
      linkedinId: id,
    });
    const role = await seedLinkedRole([`linkedin-job:${id}`]);
    expect(await groupOf(role.jobId)).toEqual(
      sorted(role.jobId, listing.jobId),
    );
    expect(await groupOf(listing.jobId)).toEqual(
      sorted(role.jobId, listing.jobId),
    );
  });

  it('two roles sharing an ats: key are one group with no listing', async () => {
    const key = `ats:ashby/acme/${linkedinJobId()}`;
    const a = await seedLinkedRole([key]);
    const b = await seedLinkedRole([
      `url:https://other.example/${linkedinJobId()}`,
      key,
    ]);
    expect(await groupOf(a.jobId)).toEqual(sorted(a.jobId, b.jobId));
    expect(await groupOf(b.jobId)).toEqual(sorted(a.jobId, b.jobId));
  });

  it('role A → listing → role B is one group', async () => {
    const id = linkedinJobId();
    const ats = `ats:greenhouse/acme/${id}`;
    const listing = await seedKeyedListing({ jobKey: ats, linkedinId: id });
    // A links the listing by its posting; B only by its LinkedIn id.
    const a = await seedLinkedRole([ats]);
    const b = await seedLinkedRole([`linkedin-job:${id}`]);
    const all = sorted(a.jobId, listing.jobId, b.jobId);
    expect(await groupOf(a.jobId)).toEqual(all);
    expect(await groupOf(b.jobId)).toEqual(all);
    expect(await groupOf(listing.jobId)).toEqual(all);
  });

  it("an unlinked job's group is itself", async () => {
    const id = linkedinJobId();
    const listing = await seedKeyedListing({
      jobKey: `linkedin-job:${id}`,
      linkedinId: id,
    });
    const role = await seedLinkedRole([]);
    expect(await groupOf(listing.jobId)).toEqual([listing.jobId]);
    expect(await groupOf(role.jobId)).toEqual([role.jobId]);
  });

  it("a merged (status <> 'active') job is not in a group", async () => {
    const id = linkedinJobId();
    const ats = `ats:ashby/acme/${id}`;
    const merged = await seedKeyedListing({
      jobKey: ats,
      linkedinId: id,
      status: 'merged',
    });
    const mergedRole = await seedLinkedRole([ats], { status: 'merged' });
    const role = await seedLinkedRole([ats, `linkedin-job:${id}`]);
    expect(await groupOf(role.jobId)).toEqual([role.jobId]);
    // The job asked about is always in its own group.
    expect(await groupOf(merged.jobId)).toContain(merged.jobId);
    expect(await groupOf(mergedRole.jobId)).toContain(mergedRole.jobId);
  });
});

describe('job link helpers', () => {
  let user: TestUser;

  beforeAll(async () => {
    user = await createTestUser();
  });

  it.each([
    ['job_link_keys', { p_job: '00000000-0000-0000-0000-000000000000' }],
    ['job_link_group', { p_job: '00000000-0000-0000-0000-000000000000' }],
    [
      'group_decision_status',
      {
        p_user: '00000000-0000-0000-0000-000000000000',
        p_job: '00000000-0000-0000-0000-000000000000',
      },
    ],
  ])('an authenticated client cannot call %s', async (fn, args) => {
    const { data, error } = await user.client.rpc(fn, args);
    expect(error).not.toBeNull();
    expect(
      error?.code === '42501' ||
        error?.code === 'PGRST202' ||
        /permission denied|Could not find the function/.test(
          error?.message ?? '',
        ),
    ).toBe(true);
    expect(data).toBeNull();
  });
});
