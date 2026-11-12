import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, anon } from './support/admin.js';
import {
  cleanupDetailedJobs,
  publishProfile,
  seedDetailedJob,
  seedMatchOn,
  seedProfile,
  type SeededJob,
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

type Row = {
  matchId: string;
  jobId: string;
  outcome: string;
  reviewRule: string | null;
  reviewField: string | null;
  reviewChoice: string | null;
};
type Review = { rule: string; field: string };

// Postgres' insufficient_privilege: a row-level security WITH CHECK refused the row.
const DENIED = '42501';
const SENIORITY: Review = { rule: 'seniority', field: 'seniority' };

describe('match_reviews and the review-aware match_details', () => {
  let a: TestUser;
  let b: TestUser;
  let profileA: string;
  let profileB: string;

  beforeAll(async () => {
    a = await createTestUser();
    b = await createTestUser();
    profileA = await seedProfile(a.id);
    await publishProfile(profileA);
    profileB = await seedProfile(b.id);
    await publishProfile(profileB);
  });

  const call = async (user: TestUser, outcome: string): Promise<Row[]> => {
    const { data, error } = await user.client.rpc('match_details', {
      p_outcome: outcome,
      p_details: false,
    });
    if (error) throw new Error(error.message);
    return data as Row[];
  };
  const rowOf = async (user: TestUser, outcome: string, jobId: string) =>
    (await call(user, outcome)).find((r) => r.jobId === jobId);
  /** The outcome lists (review, qualified, rejected) a job appears under for `user`. */
  const listsOf = async (user: TestUser, jobId: string) => {
    const lists: string[] = [];
    for (const outcome of ['review', 'qualified', 'rejected'])
      if (await rowOf(user, outcome, jobId)) lists.push(outcome);
    return lists;
  };

  /** A fresh job and A's match on it, in review on `review`. */
  const reviewMatch = async (
    review: Review = SENIORITY,
  ): Promise<{ job: SeededJob; matchId: string }> => {
    const job = await seedDetailedJob();
    const matchId = await seedMatchOn(a.id, profileA, job, {
      outcome: 'review',
      review,
    });
    return { job, matchId };
  };

  const decide = (
    user: TestUser,
    m: { job: SeededJob; matchId: string },
    choice: 'qualified' | 'rejected',
    review: Review = SENIORITY,
    as: { userId?: string; profileId?: string } = {},
  ) =>
    user.client.from('match_reviews').insert({
      userId: as.userId ?? user.id,
      profileId: as.profileId ?? profileA,
      matchId: m.matchId,
      jobId: m.job.jobId,
      choice,
      rule: review.rule,
      field: review.field,
      note: 'checked the post',
    });

  /** The engine deciding the match again, as after a profile change. */
  const redecide = async (
    matchId: string,
    outcome: 'qualified' | 'rejected' | 'review',
    review: Review | null,
  ) => {
    const { error } = await admin()
      .from('job_matches')
      .update({
        outcome,
        reviewRule: review?.rule ?? null,
        reviewField: review?.field ?? null,
        decidedAt: new Date().toISOString(),
        profileUpdatedAt: new Date().toISOString(),
      })
      .eq('id', matchId);
    if (error) throw new Error(`Could not re-decide: ${error.message}`);
  };

  it('a review row appears under review', async () => {
    const m = await reviewMatch();
    expect(await listsOf(a, m.job.jobId)).toEqual(['review']);
    expect(await rowOf(a, 'review', m.job.jobId)).toMatchObject({
      matchId: m.matchId,
      outcome: 'review',
      reviewRule: 'seniority',
      reviewField: 'seniority',
      reviewChoice: null,
    });
  });

  it('after a qualified decision it appears under qualified', async () => {
    const m = await reviewMatch();
    expect((await decide(a, m, 'qualified')).error).toBeNull();
    expect(await listsOf(a, m.job.jobId)).toEqual(['qualified']);
    expect(await rowOf(a, 'qualified', m.job.jobId)).toMatchObject({
      outcome: 'review',
      reviewRule: 'seniority',
      reviewField: 'seniority',
      reviewChoice: 'qualified',
    });
  });

  it('after a rejected decision it appears under neither', async () => {
    const m = await reviewMatch();
    expect((await decide(a, m, 'rejected')).error).toBeNull();
    expect(await listsOf(a, m.job.jobId)).toEqual(['rejected']);
  });

  it('the latest decision wins', async () => {
    const m = await reviewMatch();
    expect((await decide(a, m, 'rejected')).error).toBeNull();
    expect((await decide(a, m, 'qualified')).error).toBeNull();
    expect(await listsOf(a, m.job.jobId)).toEqual(['qualified']);
  });

  // Review Focus 4: a decision after the profile changes and the job is decided again.
  it('a decision for another rule or field does not apply', async () => {
    const m = await reviewMatch();
    expect((await decide(a, m, 'qualified')).error).toBeNull();

    // Decided again, still in review on the same rule and field: the decision applies.
    await redecide(m.matchId, 'review', SENIORITY);
    expect(await listsOf(a, m.job.jobId)).toEqual(['qualified']);

    // In review on another field of the same rule: back to review, no choice.
    await redecide(m.matchId, 'review', {
      rule: 'seniority',
      field: 'yearsRequired',
    });
    expect(await listsOf(a, m.job.jobId)).toEqual(['review']);
    expect(await rowOf(a, 'review', m.job.jobId)).toMatchObject({
      reviewRule: 'seniority',
      reviewField: 'yearsRequired',
      reviewChoice: null,
    });

    // In review on another rule.
    await redecide(m.matchId, 'review', {
      rule: 'location',
      field: 'openings',
    });
    expect(await listsOf(a, m.job.jobId)).toEqual(['review']);

    // A sure reject or a qualify: the engine's outcome wins.
    await redecide(m.matchId, 'rejected', null);
    expect(await listsOf(a, m.job.jobId)).toEqual(['rejected']);
    expect(await rowOf(a, 'rejected', m.job.jobId)).toMatchObject({
      reviewChoice: null,
    });
    const rejected = await reviewMatch();
    expect((await decide(a, rejected, 'rejected')).error).toBeNull();
    await redecide(rejected.matchId, 'qualified', null);
    expect(await listsOf(a, rejected.job.jobId)).toEqual(['qualified']);

    // Back in review on the decided rule and field: the old decision applies again.
    await redecide(m.matchId, 'review', SENIORITY);
    expect(await listsOf(a, m.job.jobId)).toEqual(['qualified']);

    // The old decision is kept as history.
    const { data } = await a.client
      .from('match_reviews')
      .select('choice, rule, field')
      .eq('matchId', m.matchId);
    expect(data).toEqual([
      { choice: 'qualified', rule: 'seniority', field: 'seniority' },
    ]);
  });

  it("a user can't attach a review to another user's match", async () => {
    const job = await seedDetailedJob();
    const matchB = await seedMatchOn(b.id, profileB, job, {
      outcome: 'review',
      review: SENIORITY,
    });
    const m = { job, matchId: matchB };
    // As themselves, or claiming B's profile.
    expect((await decide(a, m, 'qualified')).error?.code).toBe(DENIED);
    expect(
      (await decide(a, m, 'qualified', SENIORITY, { profileId: profileB }))
        .error?.code,
    ).toBe(DENIED);
    // As B.
    expect(
      (
        await decide(a, m, 'qualified', SENIORITY, {
          userId: b.id,
          profileId: profileB,
        })
      ).error?.code,
    ).toBe(DENIED);
    const { data } = await admin()
      .from('match_reviews')
      .select('id')
      .eq('matchId', matchB);
    expect(data).toEqual([]);
    expect(await listsOf(b, job.jobId)).toEqual(['review']);
  });

  it('a review must name the match’s current rule and field', async () => {
    const m = await reviewMatch();
    expect(
      (await decide(a, m, 'qualified', { rule: 'location', field: 'openings' }))
        .error?.code,
    ).toBe(DENIED);
    const job = await seedDetailedJob();
    const qualified = {
      job,
      matchId: await seedMatchOn(a.id, profileA, job),
    };
    expect((await decide(a, qualified, 'rejected')).error?.code).toBe(DENIED);
  });

  it("a user can't read another user's reviews or reports", async () => {
    const m = await reviewMatch();
    expect((await decide(a, m, 'qualified')).error).toBeNull();
    const report = await a.client.from('fact_reports').insert({
      userId: a.id,
      jobId: m.job.jobId,
      extractionId: m.job.extractionId,
      field: 'seniority',
      processorValue: 'senior',
      quote: 'Senior engineer',
      proposedValue: 'mid',
    });
    expect(report.error).toBeNull();

    for (const table of ['match_reviews', 'fact_reports']) {
      const own = await a.client.from(table).select('id');
      expect(own.error).toBeNull();
      expect(own.data?.length).toBeGreaterThan(0);
      const other = await b.client.from(table).select('id');
      expect(other.error).toBeNull();
      expect(other.data).toEqual([]);
      const nobody = await anon().from(table).select('id');
      expect(nobody.error ? [] : nobody.data).toEqual([]);
    }
  });

  it('a user can insert a report but not update it', async () => {
    const job = await seedDetailedJob();
    await seedMatchOn(a.id, profileA, job);
    const unmatched = await seedDetailedJob();
    const report = (jobId: string, userId = a.id) => ({
      userId,
      jobId,
      field: 'seniority',
      processorValue: 'senior',
      quote: 'Senior engineer',
      listingValue: 'mid_senior',
      proposedValue: 'mid',
      note: 'it is a mid role',
    });

    const inserted = await a.client
      .from('fact_reports')
      .insert(report(job.jobId))
      .select('id, proposedValue')
      .single();
    expect(inserted.error).toBeNull();
    const id = (inserted.data as { id: string }).id;

    // No update or delete policy: the row is untouched.
    await a.client
      .from('fact_reports')
      .update({ proposedValue: 'senior' })
      .eq('id', id);
    await a.client.from('fact_reports').delete().eq('id', id);
    const { data } = await admin()
      .from('fact_reports')
      .select('proposedValue')
      .eq('id', id)
      .single();
    expect(data).toEqual({ proposedValue: 'mid' });

    // Not for someone else, and not on a job the user isn't matched with.
    expect(
      (await a.client.from('fact_reports').insert(report(job.jobId, b.id)))
        .error?.code,
    ).toBe(DENIED);
    expect(
      (await a.client.from('fact_reports').insert(report(unmatched.jobId)))
        .error?.code,
    ).toBe(DENIED);
    expect(
      (await anon().from('fact_reports').insert(report(job.jobId))).error,
    ).not.toBeNull();
  });
});
