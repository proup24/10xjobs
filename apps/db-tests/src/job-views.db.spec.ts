import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, anon } from './support/admin.js';
import {
  cleanupDetailedJobs,
  publishProfile,
  seedDetailedJob,
  seedMatchOn,
  seedProfile,
} from './support/fixtures.js';
import {
  cleanupTestUsers,
  createTestUser,
  type TestUser,
} from './support/test-users.js';

// Detailed jobs reference the users' profiles, so they go before the users.
afterAll(async () => {
  await cleanupDetailedJobs();
  await cleanupTestUsers();
});

describe('job_views', () => {
  let a: TestUser;
  let b: TestUser;
  let job: string;
  let other: string;

  beforeAll(async () => {
    a = await createTestUser();
    b = await createTestUser();
    const profileA = await seedProfile(a.id);
    await publishProfile(profileA);
    const matched = await seedDetailedJob();
    await seedMatchOn(a.id, profileA, matched);
    job = matched.jobId;
    other = (await seedDetailedJob()).jobId;
  });

  const viewsOf = async (user: TestUser) => {
    const { data, error } = await user.client.from('job_views').select('*');
    expect(error).toBeNull();
    return data ?? [];
  };

  it('the owner records and reads a view', async () => {
    const { error } = await a.client
      .from('job_views')
      .insert({ userId: a.id, jobId: job });
    expect(error).toBeNull();
    const rows = await viewsOf(a);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: a.id, jobId: job });
  });

  it('a second view of the same job is ignored', async () => {
    const before = await viewsOf(a);
    for (let i = 0; i < 2; i++) {
      const { error } = await a.client
        .from('job_views')
        .upsert(
          { userId: a.id, jobId: job },
          { onConflict: 'userId,jobId', ignoreDuplicates: true },
        );
      expect(error).toBeNull();
    }
    const after = await viewsOf(a);
    expect(after).toHaveLength(1);
    expect(after[0].viewedAt).toBe(before[0].viewedAt);
  });

  it('refuses a view of an unmatched job', async () => {
    const { error } = await a.client
      .from('job_views')
      .insert({ userId: a.id, jobId: other });
    expect(error).not.toBeNull();
  });

  it('refuses a view for someone else', async () => {
    const { error } = await a.client
      .from('job_views')
      .insert({ userId: b.id, jobId: job });
    expect(error).not.toBeNull();
  });

  it("hides other users' views", async () => {
    expect(await viewsOf(b)).toEqual([]);
  });

  it('anonymous callers see and write nothing', async () => {
    const read = await anon().from('job_views').select('*');
    expect(read.error ? [] : read.data).toEqual([]);
    const write = await anon()
      .from('job_views')
      .insert({ userId: a.id, jobId: job });
    expect(write.error).not.toBeNull();
  });

  it('views go with the job', async () => {
    // The fixtures remove the job's sources, extractions and matches first, then the job.
    await cleanupDetailedJobs();
    const { data } = await admin()
      .from('job_views')
      .select('id')
      .eq('jobId', job);
    expect(data).toEqual([]);
  });
});
