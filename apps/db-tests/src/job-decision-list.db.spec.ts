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

type Row = Record<string, unknown> & { jobId: string };

describe('job_decision_list', () => {
  let a: TestUser;
  let b: TestUser;
  let j1: string;
  let j2: string;

  const list = async (user: TestUser): Promise<Row[]> => {
    const { data, error } = await user.client.rpc('job_decision_list');
    if (error) throw new Error(error.message);
    return data as Row[];
  };

  beforeAll(async () => {
    a = await createTestUser();
    b = await createTestUser();
    const profileA = await seedProfile(a.id);
    await publishProfile(profileA);
    const first = await seedDetailedJob({
      channels: ['ASHBY', 'LINKEDIN_JOB_BOARD'],
    });
    const second = await seedDetailedJob();
    await seedMatchOn(a.id, profileA, first);
    await seedMatchOn(a.id, profileA, second);
    j1 = first.jobId;
    j2 = second.jobId;
    const applied = await a.client
      .from('job_decisions')
      .insert({ userId: a.id, jobId: j1, status: 'applied' });
    expect(applied.error).toBeNull();
    const dismissed = await a.client.from('job_decisions').insert({
      userId: a.id,
      jobId: j2,
      status: 'dismissed',
      reason: 'stack',
    });
    expect(dismissed.error).toBeNull();
  });

  it("lists the caller's decisions newest first", async () => {
    const rows = await list(a);
    expect(rows.map((r) => r.jobId)).toEqual([j2, j1]);
    expect(rows[0]).toMatchObject({ status: 'dismissed', reason: 'stack' });
    expect(rows[1]).toMatchObject({
      status: 'applied',
      reason: null,
      title: 'Senior Backend Engineer',
      closed: false,
      hasMatch: true,
      channels: ['ASHBY', 'LINKEDIN_JOB_BOARD'],
    });
  });

  it('keeps a job whose match is gone', async () => {
    const gone = await admin()
      .from('job_matches')
      .delete()
      .eq('userId', a.id)
      .eq('jobId', j1);
    expect(gone.error).toBeNull();
    const rows = await list(a);
    const row = rows.find((r) => r.jobId === j1);
    expect(row).toMatchObject({ hasMatch: false });
    expect(rows.find((r) => r.jobId === j2)).toMatchObject({ hasMatch: true });
  });

  it('keeps a closed job', async () => {
    const closed = await admin()
      .from('normalized_jobs')
      .update({ closed: true })
      .eq('id', j1);
    expect(closed.error).toBeNull();
    const row = (await list(a)).find((r) => r.jobId === j1);
    expect(row).toMatchObject({ closed: true });
  });

  it('returns nothing for another user or anon', async () => {
    expect(await list(b)).toEqual([]);
    const { data, error } = await anon().rpc('job_decision_list');
    expect(error?.message).toMatch(/permission denied/);
    expect(data).toBeNull();
  });
});
