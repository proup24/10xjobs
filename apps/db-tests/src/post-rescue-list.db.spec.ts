import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin } from './support/admin.js';
import {
  blockAuthor,
  cleanupDetailedJobs,
  enablePostSearch,
  postDetail,
  publishProfile,
  seedMatchOn,
  seedPost,
  seedPostQuery,
  seedPostRawItem,
  seedPostRole,
  seedProfile,
  unblockAuthor,
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

describe('post_rescue_list', () => {
  let a: TestUser;
  let b: TestUser;
  let p1: string;
  let role: SeededJob;

  beforeAll(async () => {
    a = await createTestUser();
    b = await createTestUser();
    p1 = await seedProfile(a.id);
    await publishProfile(p1);
    const pB = await seedProfile(b.id);
    await publishProfile(pB);
    const post = await seedPost({
      verdict: 'hiring',
      roles: [{ roleKey: 'role', email: null }],
      sources: [
        postDetail({
          authorKey: 'profile:sharer',
          original: { authorKey: 'profile:orig', authorName: 'Olga Original' },
        }),
      ],
    });
    role = await seedPostRole(post, 'role');
    await seedMatchOn(a.id, p1, role, {
      outcome: 'rejected',
      checks: [{ rule: 'seniority', outcome: 'fail', reason: 'too junior' }],
    });
    await seedMatchOn(b.id, pB, role, { outcome: 'rejected' });
    const { error } = await a.client.rpc('post_rescue', {
      p_job_id: role.jobId,
    });
    expect(error).toBeNull();
  });

  const listOf = async (
    user: TestUser,
  ): Promise<{ jobId: string; decisionStatus: string | null }[]> => {
    const { data, error } = await user.client.rpc('post_rescue_list');
    expect(error).toBeNull();
    return data ?? [];
  };

  it('returns a disqualified rescue with the profiles that rejected it', async () => {
    expect(await listOf(a)).toEqual([
      expect.objectContaining({
        jobId: role.jobId,
        kind: 'post_role',
        origin: 'disqualified',
        profileIds: [p1],
        title: 'Senior Backend Engineer',
        authorName: 'Olga Original',
        decisionStatus: null,
      }),
    ]);
    expect(await listOf(b)).toEqual([]);
  });

  it('hides the rescue while its original author is blocked, and unblocking brings it back', async () => {
    await blockAuthor(a.id, 'profile:orig');
    expect(await listOf(a)).toEqual([]);
    await unblockAuthor(a.id, 'profile:orig');
    expect((await listOf(a)).map((r) => r.jobId)).toEqual([role.jobId]);
  });

  it("reports the group's decision", async () => {
    const { error } = await a.client
      .from('job_decisions')
      .insert({ userId: a.id, jobId: role.jobId, status: 'applied' });
    expect(error).toBeNull();
    expect((await listOf(a))[0].decisionStatus).toBe('applied');
  });
});

describe('post_rescue_list after the rows behind a rescue change', () => {
  const listOf = async (user: TestUser) => {
    const { data, error } = await user.client.rpc('post_rescue_list');
    expect(error).toBeNull();
    return data ?? [];
  };

  it('a disqualified rescue keeps its profile once its rejected match is deleted', async () => {
    const u = await createTestUser();
    const profile = await seedProfile(u.id);
    await publishProfile(profile);
    const post = await seedPost({
      verdict: 'hiring',
      roles: [{ roleKey: 'role', email: null }],
    });
    const role = await seedPostRole(post, 'role');
    await seedMatchOn(u.id, profile, role, { outcome: 'rejected' });
    expect(
      (await u.client.rpc('post_rescue', { p_job_id: role.jobId })).error,
    ).toBeNull();
    const { error } = await admin()
      .from('job_matches')
      .delete()
      .eq('userId', u.id)
      .eq('jobId', role.jobId);
    expect(error).toBeNull();
    expect(await listOf(u)).toEqual([
      expect.objectContaining({ jobId: role.jobId, profileIds: [profile] }),
    ]);
  });

  it('a junk rescue keeps the profiles that found it, and hides once a role of its post is listed', async () => {
    const u = await createTestUser();
    const profile = await seedProfile(u.id);
    await publishProfile(profile);
    await enablePostSearch(profile);
    const post = await seedPost({ verdict: 'junk', reason: 'funnel' });
    const queryId = await seedPostQuery(profile);
    await seedPostRawItem(post.jobId, [queryId]);
    expect(
      (await u.client.rpc('post_rescue', { p_job_id: post.jobId })).error,
    ).toBeNull();
    // The query no longer links to the profile: the snapshot still names it.
    const unlink = await admin()
      .from('profile_query_search_builders')
      .delete()
      .eq('profileId', profile)
      .eq('queryId', queryId);
    expect(unlink.error).toBeNull();
    expect(await listOf(u)).toEqual([
      expect.objectContaining({
        jobId: post.jobId,
        origin: 'junk',
        profileIds: [profile],
      }),
    ]);
    // A re-extraction made a role of the post, and it matched: the role shows instead.
    const role = await seedPostRole(post, 'role');
    await seedMatchOn(u.id, profile, role, { outcome: 'qualified' });
    expect(await listOf(u)).toEqual([]);
  });
});
