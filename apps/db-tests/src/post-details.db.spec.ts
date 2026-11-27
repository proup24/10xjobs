import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin } from './support/admin.js';
import {
  cleanupDetailedJobs,
  enablePostSearch,
  postDetail,
  publishProfile,
  seedKeyedListing,
  seedMatchOn,
  seedPost,
  seedPostQuery,
  seedPostRawItem,
  seedPostRole,
  seedProfile,
  type SeededJob,
} from './support/fixtures.js';
import {
  cleanupTestUsers,
  createTestUser,
  type TestUser,
} from './support/test-users.js';

afterAll(async () => {
  await cleanupDetailedJobs();
  await cleanupTestUsers();
});

describe('post_details', () => {
  let a: TestUser;
  let stranger: TestUser;
  let post: SeededJob;
  let role: SeededJob;
  let listing: SeededJob;
  let unmatchedListing: SeededJob;
  let junk: SeededJob;
  const sources = [
    postDetail({
      authorKey: 'profile:sharer',
      authorName: 'Sam Sharer',
      original: { authorKey: 'profile:orig', authorName: 'Olga Original' },
    }),
  ];

  beforeAll(async () => {
    a = await createTestUser();
    stranger = await createTestUser();
    const profileA = await seedProfile(a.id);
    await publishProfile(profileA);
    await enablePostSearch(profileA);
    const key = `ats:greenhouse:acme:${randomUUID()}`;
    const otherKey = `ats:greenhouse:acme:${randomUUID()}`;
    listing = await seedKeyedListing({ jobKey: key });
    unmatchedListing = await seedKeyedListing({ jobKey: otherKey });
    post = await seedPost({
      verdict: 'hiring',
      roles: [{ roleKey: 'role', email: 'jobs@acme.test' }],
      sources,
    });
    role = await seedPostRole(post, 'role', [key, otherKey]);
    await seedMatchOn(a.id, profileA, role, { outcome: 'qualified' });
    await seedMatchOn(a.id, profileA, listing, { outcome: 'qualified' });

    junk = await seedPost({ verdict: 'junk', reason: 'funnel' });
    await seedPostRawItem(junk.jobId, [await seedPostQuery(profileA)]);
  });

  it("returns a role's how to apply, its post's sources and its matched linked listing", async () => {
    const { data, error } = await a.client.rpc('post_details', {
      p_job_id: role.jobId,
    });
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    const [row] = data ?? [];
    expect(row).toMatchObject({
      jobId: role.jobId,
      kind: 'post_role',
      postJobId: post.jobId,
      authorRelation: 'employer',
      emailPending: true,
      rescue: null,
      verdict: { value: 'hiring', confidence: 'sure', reason: 'hiring' },
      howToApply: { kinds: ['email'], email: 'jobs@acme.test' },
    });
    expect(row.sources).toEqual(sources);
    expect(row.linked).toEqual([
      {
        jobId: listing.jobId,
        kind: 'job',
        title: 'Senior Backend Engineer',
        authorName: null,
      },
    ]);
    expect(JSON.stringify(row.linked)).not.toContain(unmatchedListing.jobId);
  });

  it('a stranger gets no row', async () => {
    for (const job of [role, post, junk]) {
      const { data, error } = await stranger.client.rpc('post_details', {
        p_job_id: job.jobId,
      });
      expect(error).toBeNull();
      expect(data).toEqual([]);
    }
  });

  it("returns a Junk post found by the caller's search, with no role fields", async () => {
    const { data, error } = await a.client.rpc('post_details', {
      p_job_id: junk.jobId,
    });
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]).toMatchObject({
      jobId: junk.jobId,
      kind: 'post',
      postJobId: junk.jobId,
      howToApply: null,
      authorRelation: null,
      emailPending: false,
      verdict: { value: 'junk', reason: 'funnel' },
    });
  });

  it('group_decision_job names the linked job that holds the decision', async () => {
    const none = await a.client.rpc('group_decision_job', {
      p_job_id: role.jobId,
    });
    expect(none.error).toBeNull();
    expect(none.data).toBeNull();
    const { error } = await admin()
      .from('job_decisions')
      .insert({ userId: a.id, jobId: listing.jobId, status: 'applied' });
    expect(error).toBeNull();
    const found = await a.client.rpc('group_decision_job', {
      p_job_id: role.jobId,
    });
    expect(found.data).toBe(listing.jobId);
    const other = await stranger.client.rpc('group_decision_job', {
      p_job_id: role.jobId,
    });
    expect(other.data).toBeNull();
  });
});
