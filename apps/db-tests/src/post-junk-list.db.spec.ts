import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  blockAuthor,
  cleanupDetailedJobs,
  enablePostSearch,
  postDetail,
  publishProfile,
  seedPost,
  seedPostQuery,
  seedPostRawItem,
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

type JunkRow = {
  jobId: string;
  profileIds: string[];
  verdict: string;
  confidence: string;
  reason: string;
  authorName: string | null;
  authorKey: string | null;
  text: string | null;
};

describe('post_junk_list', () => {
  let a: TestUser;
  let b: TestUser;
  let p1: string;
  let junk: SeededJob;
  let share: SeededJob;
  let nullQuery: SeededJob;
  let onlyB: SeededJob;
  let blocked: SeededJob;
  let hiring: SeededJob;
  let draftFound: SeededJob;
  const since = new Date(Date.now() - 3_600_000).toISOString();

  beforeAll(async () => {
    a = await createTestUser();
    b = await createTestUser();
    p1 = await seedProfile(a.id);
    await publishProfile(p1);
    await enablePostSearch(p1);
    const q1 = await seedPostQuery(p1);
    // A draft profile of A's: its query's sightings attribute to nobody.
    const draft = await seedProfile(a.id);
    await enablePostSearch(draft);
    const qDraft = await seedPostQuery(draft);
    const pB = await seedProfile(b.id);
    await publishProfile(pB);
    await enablePostSearch(pB);
    const qB = await seedPostQuery(pB);

    junk = await seedPost({
      verdict: 'junk',
      reason: 'funnel',
      descriptionText: 'Join our group',
    });
    await seedPostRawItem(junk.jobId, [q1, qB]);

    // A share: found only through its original's raw item.
    share = await seedPost({
      verdict: 'not_hiring',
      confidence: 'unsure',
      reason: 'open_to_work',
      sources: [
        postDetail({
          authorKey: 'profile:sharer',
          authorName: 'Sam Sharer',
          original: { authorKey: 'profile:orig', authorName: 'Olga Original' },
        }),
      ],
    });
    await seedPostRawItem(share.jobId, []);
    await seedPostRawItem(share.jobId, [q1]);

    nullQuery = await seedPost({ verdict: 'junk' });
    await seedPostRawItem(nullQuery.jobId, [null]);

    onlyB = await seedPost({ verdict: 'junk' });
    await seedPostRawItem(onlyB.jobId, [qB]);

    blocked = await seedPost({
      verdict: 'not_hiring',
      sources: [
        postDetail({
          authorKey: 'profile:Blocked-Sharer',
          original: { authorKey: 'profile:fine' },
        }),
      ],
    });
    await seedPostRawItem(blocked.jobId, [q1]);
    await blockAuthor(a.id, 'profile:blocked-sharer');

    hiring = await seedPost({ verdict: 'hiring' });
    await seedPostRawItem(hiring.jobId, [q1]);

    draftFound = await seedPost({ verdict: 'junk' });
    await seedPostRawItem(draftFound.jobId, [qDraft]);
  }, 90_000);

  const listOf = async (user: TestUser): Promise<JunkRow[]> => {
    const { data, error } = await user.client.rpc('post_junk_list', {
      p_since: since,
    });
    expect(error).toBeNull();
    const ids = new Set(
      [junk, share, nullQuery, onlyB, blocked, hiring, draftFound].map(
        (j) => j.jobId,
      ),
    );
    return ((data ?? []) as JunkRow[]).filter((r) => ids.has(r.jobId));
  };

  it("lists the junk posts the caller's published post-search profiles found, newest first", async () => {
    const rows = await listOf(a);
    expect(rows.map((r) => r.jobId)).toEqual([share.jobId, junk.jobId]);
    expect(rows.map((r) => r.profileIds)).toEqual([[p1], [p1]]);
    expect(rows[1]).toMatchObject({
      verdict: 'junk',
      confidence: 'sure',
      reason: 'funnel',
      text: 'Join our group',
    });
  });

  it("shows a share's original author", async () => {
    const [row] = (await listOf(a)).filter((r) => r.jobId === share.jobId);
    expect(row).toMatchObject({
      verdict: 'not_hiring',
      confidence: 'unsure',
      authorName: 'Olga Original',
      authorKey: 'profile:orig',
    });
  });

  it("leaves out a null-query sighting, another user's sighting, a blocked sharer and a hiring post", async () => {
    const ids = (await listOf(a)).map((r) => r.jobId);
    for (const job of [nullQuery, onlyB, blocked, hiring, draftFound])
      expect(ids).not.toContain(job.jobId);
  });

  it("a rescue takes the post out of the rescuer's list only", async () => {
    const before = (await listOf(b)).map((r) => r.jobId);
    expect(before).toContain(junk.jobId);
    const { error } = await a.client.rpc('post_rescue', {
      p_job_id: junk.jobId,
      p_note: 'this one is for me',
    });
    expect(error).toBeNull();
    expect((await listOf(a)).map((r) => r.jobId)).not.toContain(junk.jobId);
    expect((await listOf(b)).map((r) => r.jobId)).toContain(junk.jobId);
  });

  it('post_rescue on a Junk post records origin junk and the verdict', async () => {
    const { data, error } = await a.client
      .from('post_rescues')
      .select('origin, note, snapshot')
      .eq('jobId', junk.jobId)
      .is('undoneAt', null)
      .single();
    expect(error).toBeNull();
    expect(data).toMatchObject({
      origin: 'junk',
      note: 'this one is for me',
      snapshot: {
        verdict: { value: 'junk', reason: 'funnel', confidence: 'sure' },
        extractionId: junk.extractionId,
        profileIds: [p1],
      },
    });
  });

  it("post_rescue refuses a post that is not in the caller's Junk tab", async () => {
    for (const job of [onlyB, hiring, blocked]) {
      const { error } = await a.client.rpc('post_rescue', {
        p_job_id: job.jobId,
      });
      expect(error?.message).toContain('not rescuable');
    }
  });
});
