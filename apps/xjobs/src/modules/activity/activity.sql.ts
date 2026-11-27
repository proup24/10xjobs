import type { DatabaseClient } from '@xjobs/database';

type Raw = DatabaseClient['raw'];
/** A CTE fragment, spliced after `WITH`. */
type Cte = ReturnType<ReturnType<Raw['sql']>['returnsRow']>;

const UUID = 'pg/uuid@1';
const TEXT = 'pg/text@1';

/**
 * The users whose searches pause at `at`, as the CTE `paused_users ("userId")`:
 * the only definition of a paused user. Spliced in as `WITH ${…}`.
 *
 * A user is paused when a match has waited in their Matches list at least
 * `hours` (a qualified match of a published profile, on an active, open job
 * seen in the last 7 days, with no decision, decided at or before
 * `at − hours`; the list of `match_details` and the web page; a post role
 * counts unless it is Email pending or has a live rescue, of itself or of
 * its post) and none of the
 * six activity signals falls in `(at − hours, at]`: a decision of any status,
 * a job view, a review choice, a webhook callback, a resume, or a
 * published profile's `publishedAt`. A waiting match implies a published
 * profile.
 */
export function pausedUsersCte(raw: Raw, at: Date, hours: number): Cte {
  const t = at.toISOString();
  return raw.sql`paused_users AS (
    SELECT u.id AS "userId"
      FROM public.users u
      CROSS JOIN (SELECT ${t}::timestamptz AS "at",
                         ${t}::timestamptz - make_interval(hours => ${hours}::int) AS "since") w
     WHERE EXISTS (
             SELECT 1 FROM public.job_matches m
               JOIN public.profiles p ON p.id = m."profileId" AND p.state = 'published'
               JOIN public.normalized_jobs j ON j.id = m."jobId"
               LEFT JOIN public.job_facts f ON f."jobId" = m."jobId"
              WHERE m."userId" = u.id
                AND m.outcome = 'qualified'
                -- Listings and post roles both wait in the user's lists. A post role
                -- that is Email pending waits on slice 05's sending, not on the user,
                -- and a live rescue (of the role, or of its post from Junk) is the user's
                -- own act, not a waiting match.
                AND j.kind IN ('job', 'post_role')
                AND NOT (j.kind = 'post_role'
                         AND (public.post_email_pending(m."userId", m."jobId")
                              OR EXISTS (SELECT 1 FROM public.post_rescues r
                                          WHERE r."userId" = m."userId"
                                            AND r."jobId" IN (j.id, j."parentJobId")
                                            AND r."undoneAt" IS NULL)))
                AND m."decidedAt" <= w."since"
                AND j.status = 'active'
                AND j."lastSeenAt" >= w."at" - interval '7 days'
                -- match_details' "closed", with the expiry judged at the tick.
                AND NOT (j.closed OR COALESCE(f.closed, false)
                         OR (j."expiresAt" IS NOT NULL AND j."expiresAt" <= w."at"))
                AND NOT EXISTS (
                  SELECT 1 FROM public.job_decisions d
                   WHERE d."userId" = m."userId" AND d."jobId" = m."jobId"))
       AND (u."searchesResumedAt" > w."since" AND u."searchesResumedAt" <= w."at") IS NOT TRUE
       AND NOT EXISTS (
             SELECT 1 FROM public.job_decisions d
              WHERE d."userId" = u.id AND d."decidedAt" > w."since" AND d."decidedAt" <= w."at")
       AND NOT EXISTS (
             SELECT 1 FROM public.job_views v
              WHERE v."userId" = u.id AND v."viewedAt" > w."since" AND v."viewedAt" <= w."at")
       AND NOT EXISTS (
             SELECT 1 FROM public.match_reviews r
              WHERE r."userId" = u.id AND r."createdAt" > w."since" AND r."createdAt" <= w."at")
       AND NOT EXISTS (
             SELECT 1 FROM public.webhook_callbacks x
              WHERE x."userId" = u.id
                AND x."receivedAt" > w."since" AND x."receivedAt" <= w."at")
       AND NOT EXISTS (
             SELECT 1 FROM public.profiles p
              WHERE p."userId" = u.id AND p.state = 'published'
                AND p."publishedAt" > w."since" AND p."publishedAt" <= w."at"))`.returnsRow(
    { userId: UUID },
  );
}

/**
 * The CTE `paused_builders (id, channel)`, after `paused_users`: active,
 * non-deleted builders with at least one published-profile owner, every one
 * of them paused.
 */
export function pausedBuildersCte(raw: Raw): Cte {
  return raw.sql`builder_owners AS (
    SELECT l."queryId", p."userId"
      FROM public.profile_query_search_builders l
      JOIN public.profiles p ON p.id = l."profileId" AND p.state = 'published'
  ), paused_builders AS (
    SELECT q.id, q.channel
      FROM public.query_search_builder q
     WHERE q."isActive" AND NOT q."isDeleted"
       AND EXISTS (SELECT 1 FROM builder_owners o WHERE o."queryId" = q.id)
       AND NOT EXISTS (
             SELECT 1 FROM builder_owners o
              WHERE o."queryId" = q.id
                AND NOT EXISTS (SELECT 1 FROM paused_users pu WHERE pu."userId" = o."userId")))`.returnsRow(
    { id: UUID, channel: TEXT },
  );
}
