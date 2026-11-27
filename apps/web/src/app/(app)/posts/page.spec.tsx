import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Page from './page';

const redirect = vi.hoisted(() =>
  vi.fn((to: string) => {
    throw new Error(`redirect ${to}`);
  }),
);
vi.mock('next/navigation', () => ({
  redirect,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getClaims: async () => ({ data: { claims: { sub: 'u1' } } }) },
    rpc,
  }),
}));
const profiles = vi.hoisted(() => ({ items: [] as unknown[] }));
vi.mock('../preferences/data', () => ({
  preferenceProfiles: async () => ({ items: profiles.items, labels: {} }),
  preferenceLists: async () => ({
    positions: [],
    seniorities: [],
    techs: [],
    countries: [],
    regions: [],
    cities: [],
    languages: [],
    currencies: [],
    contractTypes: [],
  }),
}));
const viewProps = vi.hoisted(() => ({
  last: null as null | Record<string, unknown>,
}));
vi.mock('@/components/posts/posts-view', () => ({
  PostsView: (props: Record<string, unknown>) => {
    viewProps.last = props;
    return null;
  },
}));
vi.mock('../actions', () => ({
  decideReviewAction: vi.fn(),
  decideJobAction: vi.fn(),
  clearJobDecisionAction: vi.fn(),
  reportMismatchAction: vi.fn(),
}));

const P1 = '11111111-1111-4111-8111-111111111111';
const profile = (postSearch: boolean) => ({
  id: P1,
  position: 'Engineer',
  state: 'published',
  postSearch,
});

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ data: [], error: null });
});
afterEach(cleanup);

const renderPage = async (sp: Record<string, string> = {}) =>
  render(await Page({ searchParams: Promise.resolve(sp) }));

describe('Social posts page', () => {
  it('redirects to the job board when no profile has post search on', async () => {
    profiles.items = [profile(false)];
    await expect(renderPage()).rejects.toThrow('redirect /');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('reads post roles for its three match lists', async () => {
    profiles.items = [profile(true)];
    await renderPage();
    const reads = rpc.mock.calls.filter(([fn]) => fn === 'match_details');
    expect(reads.map(([, args]) => args.p_outcome).sort()).toEqual([
      'qualified',
      'rejected',
      'review',
    ]);
    for (const [, args] of reads) expect(args.p_kind).toBe('post_role');
    expect(rpc).toHaveBeenCalledWith('post_junk_list', expect.anything());
    expect(rpc).toHaveBeenCalledWith('post_rescue_list');
    expect(viewProps.last).not.toBeNull();
  });

  // A decision inherited through a linked group opens the copy that holds it.
  it("redirects a decided post to its group's decided copy in Applications", async () => {
    profiles.items = [profile(true)];
    const J = '99999999-9999-4999-8999-999999999999';
    const L = '88888888-8888-4888-8888-888888888888';
    rpc.mockImplementation(
      async (fn: string, args: Record<string, unknown>) => {
        if (fn === 'match_details' && args.p_job_id === J)
          return {
            data: [
              {
                jobId: J,
                matchId: 'm',
                profileId: P1,
                kind: 'post_role',
                outcome: 'qualified',
                closed: false,
                decisionStatus: 'applied',
              },
            ],
            error: null,
          };
        if (fn === 'group_decision_job') return { data: L, error: null };
        return { data: [], error: null };
      },
    );
    await expect(renderPage({ job: J })).rejects.toThrow(
      `redirect /applications?job=${L}`,
    );
    expect(rpc).toHaveBeenCalledWith('group_decision_job', { p_job_id: J });
  });

  it('reads no group decision for an undecided post', async () => {
    profiles.items = [profile(true)];
    await renderPage({ job: '99999999-9999-4999-8999-999999999999' });
    expect(rpc).not.toHaveBeenCalledWith(
      'group_decision_job',
      expect.anything(),
    );
  });

  it('sends Disqualified its failed reasons, not the full rows', async () => {
    profiles.items = [profile(true)];
    const J = '99999999-9999-4999-8999-999999999999';
    rpc.mockImplementation(
      async (fn: string, args: Record<string, unknown>) => {
        if (fn === 'match_details' && args.p_outcome === 'rejected')
          return {
            data: [
              {
                jobId: J,
                matchId: 'm',
                profileId: P1,
                kind: 'post_role',
                outcome: 'rejected',
                postedAt: new Date().toISOString(),
                firstSeenAt: new Date().toISOString(),
                decidedAt: new Date().toISOString(),
                closed: false,
                channels: ['LINKEDIN_POSTS'],
                descriptionText: 'the whole post',
                conflicts: [{ field: 'x' }],
                checks: [
                  { rule: 'position', outcome: 'pass', reason: 'ok' },
                  { rule: 'seniority', outcome: 'fail', reason: 'too junior' },
                ],
                facts: {
                  arrangement: { code: 'remote', label: 'Remote' },
                  seniority: { code: 'junior', label: 'Junior' },
                  openings: [
                    {
                      arrangements: [{ code: 'remote', label: 'Remote' }],
                      places: [],
                    },
                  ],
                },
              },
            ],
            error: null,
          };
        return { data: [], error: null };
      },
    );
    await renderPage();
    const props = viewProps.last as {
      rejected: { jobId: string; rows: Record<string, unknown>[] }[];
      failedReasons: Record<string, Record<string, string>>;
    };
    expect(props.failedReasons).toEqual({ [J]: { [P1]: 'too junior' } });
    const [row] = props.rejected[0].rows;
    expect(row.checks).toBeNull();
    expect(row.descriptionText).toBeNull();
    expect(row.conflicts).toBeNull();
    expect(row.facts).toEqual({
      arrangement: { code: 'remote', label: 'Remote' },
      openings: [{ arrangements: [{ code: 'remote', label: 'Remote' }] }],
    });
  });
});
