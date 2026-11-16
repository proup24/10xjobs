# Job decisions: applied and not for me

Date: 2026-11-16
Status: approved 2026-11-16
Builds on: [matches view](2026-11-11-matches-view-design.md), [listing facts](2026-11-12-listing-facts-design.md) (review decisions)

## Intent

Today a job in Matches stays there until it ages out of the 7-day window. The user has no way to say "I applied" or "not for me", so the list mixes the jobs still waiting on them with the ones they're done with _(user)_.

After reviewing a job, the user marks it **Applied** or **Not for me**. Either way it leaves Matches and goes to its own place, so Matches holds only the jobs still to decide _(user)_.

A "not for me" on a qualified job is also a signal: the matcher let through a job the user didn't want, which is the project's first anti-goal. Recording an optional reason makes those misses findable.

## Goals

- In a job's detail on Matches, two actions: **Applied** and **Not for me** _(user)_.
- A marked job no longer shows in Matches, under any profile or tab _(user)_.
- A new sidebar page, **Applications**, lists the marked jobs, with an **Applied / Not for me** switch at the top. Matches and Review get no new tabs _(user, option A)_.
- **Not for me** offers an optional reason from a dropdown of known reasons, plus an optional free-text note. Both can be skipped _(user)_.
- Every mark can be changed: from Applications, **Move back to Matches** clears it, and a job can be switched between Applied and Not for me _(my call)_.
- `db:analyze` reports the "not for me" reasons, so the rules that let wrong jobs through are visible _(my call)_.

## Non-goals

- **Application tracking beyond "applied".** No interview, offer, rejection-by-employer or follow-up states, no notes on applied jobs. That is Phase 5. This slice records when the job was marked, which Phase 5 can build on.
- **Changing the matcher from a dismissal.** The reason is recorded and reported, not fed back into matching. Fixes still go through preferences or a matcher rule change.
- **Actions on Review items.** Review keeps its own Move to Matches / Reject. A review item the user moves to Matches can then be marked like any match _(my call)_.
- **Telling the webhook receiver.** A mark is not sent anywhere.
- **Bulk marking** several jobs at once.

## Anti-goals

- **A marked job coming back into Matches** by itself: after a re-decision, a rematch, a reprocess, a `MATCHER_VERSION` bump or a duplicate merge.
- **Losing an applied job.** A job the user applied to must stay on Applications even if the engine later rejects it, the job closes, or the profile that matched it is deleted.
- **Blurring "not for me" with the engine's rejections.** The engine's `rejected` outcome and the review Reject keep their meaning. The user's dismissal has its own name and its own data.
- **Leaking another user's data.** Decisions are the owner's alone (RLS), and the table can't be used to probe job ids.

## Approaches

1. **One decision table, one row per user and job** _(user picked)_. `job_decisions` holds `applied` or `dismissed`, an optional reason and note, and when. Matches leaves out decided jobs, Applications lists them, undo deletes the row, and switching updates it. Simple and fast to read. It keeps no history of changes, but Phase 5's outcome tracking would want its own events anyway.
2. **An append-only history, newest row wins** (like `match_reviews`). Keeps a full trail, but every read must find the latest row first, and the RLS and queries get harder. Not needed before Phase 5.

Ruled out: a status column on `job_views` (it means "opened the link", is written once and has no update) and reusing `match_reviews` (tied to one profile's match and only valid while the match is in review).

## Decisions

### Per job, not per profile _(user agreed)_

The user applies to a job, not to a profile. One decision per (user, job) hides the job from every profile's list and from "All profiles".

### Data: `job_decisions`

In the Prisma contract, RLS included:

| Column          | Notes                                                                       |
| --------------- | --------------------------------------------------------------------------- |
| `id`            | uuid, database default (users insert through PostgREST)                     |
| `userId`        | owner; cascades on user delete                                              |
| `jobId`         | the normalized job; cascades on job delete                                  |
| `status`        | `applied` or `dismissed` (check constraint)                                 |
| `reason`        | nullable; one of the dismiss reasons below (check constraint)               |
| `note`          | nullable free text, trimmed, at most 500 characters (same limit as reviews) |
| `decidedAt`     | when the current status was set; reset when the status changes              |
| `matchSnapshot` | nullable jsonb; on a dismissal, what let the job through (see `db:analyze`) |
| timestamps      | `createdAt` / `updatedAt` mixin                                             |

- Unique on (`userId`, `jobId`).
- Check: `reason`, `note` and `matchSnapshot` are null when `status = 'applied'` _(my call: Applied carries no reason; Phase 5 adds its own notes)_. Switching to Applied clears them.
- RLS for `authenticated`:
  - **select:** own rows.
  - **insert:** own rows, only for a job the user has a match for (the same `EXISTS` on `job_matches` that `job_views_owner_insert` uses).
  - **update:** own rows, and `userId` and `jobId` can't change (enforced by a `BEFORE UPDATE` trigger or column grants). The update does **not** require a current match _(my call)_: an applied job whose match is gone (profile deleted, `db:archive-actor`, a merge onto a job the user has no match for) must still be editable from Applications.
  - **delete:** own rows.
- The migration's ref hash in `app/refs/db.json` must advance, or the migration never applies.

### Dismiss reasons _(user: dropdown plus note; the list is my call)_

Codes, stored in `reason`, with the labels shown:

| Code                 | Label                       |
| -------------------- | --------------------------- |
| `role`               | Not the role I want         |
| `seniority`          | Wrong seniority             |
| `location`           | Location or arrangement     |
| `stack`              | Tech stack                  |
| `salary`             | Salary                      |
| `contract`           | Contract type or engagement |
| `languages`          | Language requirements       |
| `work_authorization` | Work authorization          |
| `company`            | The company                 |
| `other`              | Something else              |

The first eight line up with the matcher's rules, so `db:analyze` can show which rule let the job through. The list lives in one constant shared by the web app's schema and the check constraint's values (the database enum convention: a TypeScript twin in `libs/database/src/enums/`).

### Reading

- **Matches:** `match_details` gains one column, the caller's decision status for the job (null when none), from a left join on `job_decisions` by `jobId` and `auth.uid()`. The matches page leaves out rows with a decision. Review does too: a job the user already marked doesn't show in Review either _(my call)_.
- **Applications:** a new `SECURITY DEFINER` RPC, `job_decision_list()`, returns the caller's decisions with the job's summary columns (title, company, location, posted time, closed, links, channels), newest `decidedAt` first. It reads jobs **through the decision row, not through a current match**, so an applied job stays listed after the engine rejects it or the profile is deleted. A decision row could only be inserted for a matched job, so it doesn't open job ids to probing. Revoked from `anon`, granted to `authenticated`, like `match_details`.
- **Detail on Applications:** opening a job shows the same job detail as Matches. When a match still exists, `match_details` is called with `p_job_id` and **any outcome** (a `p_outcome` of null means any; today it defaults to `qualified`), so "Why it matched" still shows. When none exists, the detail shows the job without the match section.
- The isolation harness gains: decisions are visible only to their owner; insert is refused for a job the user has no match for; the new column and RPC return only the caller's data; the allowlist test covers them.

### Writing

- Server actions beside the review action (`apps/web/src/app/(app)/actions.ts`), validated with zod like `saveReview`: `markApplied(jobId)`, `markDismissed(jobId, reason?, note?)`, `clearDecision(jobId)`. Mark updates the existing row if there is one, and inserts otherwise. It is not an `INSERT ... ON CONFLICT DO UPDATE`, because that runs the insert policy's match check and would refuse edits on jobs whose match is gone. A unique violation from a race is retried as an update. `decidedAt` changes only when the status changes. Log lines carry ids and error codes only.
- On a dismissal, the action reads the caller's current matches for the job itself, never from the client, and stores them in `matchSnapshot` as `[{ profileId, outcome, matcherVersion, checks }]`. Re-decisions later overwrite `job_matches` in place, so without a copy, what let the job through would be lost _(my call)_.
- A job the user can't mark (no match, someone else's) fails the same way a review on a missing match does.

### Duplicates merge

When ingest merges job A into job B (`A.mergedIntoId = B`), the merge transaction in `jobs.writer.ts` moves A's decisions to B. If the user already has a decision on both, **Applied wins**, and otherwise the newer `decidedAt` wins. The survivor is kept on B and the other row is deleted _(my call: never lose an applied job)_. Without this, a job the user dismissed would come back as the merged duplicate.

`linkJob` can also bring a merged job back: it turns `active` again with `mergedIntoId` cleared. When that happens, B's decision is **copied** back to the revived job if the user has none on it, because the two were the same posting _(my call)_. B keeps its own row.

### The Matches detail

Under **Open post** and **Apply** in the detail, the two actions:

```
[ Open post ]  [ Apply ]
[ Applied ]    [ Not for me ]
```

- **Applied** marks at once. A toast says "Moved to Applications" with **Undo** _(my call: it's one click and easy to undo, so no confirm)_.
- **Not for me** opens a dialog: a reason select (optional, "No reason" by default), a note textarea (optional), then **Not for me** and **Cancel**. After saving, the same toast with Undo.
- After either action, the job leaves the list and the next job in the list is selected, or the list shows with nothing selected at phone width _(my call: you're working through a list)_.
- Built only from `components/ui` (button, dialog, select, textarea, sonner) and theme tokens, following `apps/web/DESIGN.md`.

### The Applications page

- Sidebar entry **Applications** between Matches and Preferences, at `/applications`, added to `NAV_ITEMS`.
- At the top, a two-way switch: **Applied** (default) and **Not for me**, each with its count. The choice is in the URL, like the matches view's state.
- No profile, source or time filters, and no time window: it's the user's history _(my call)_.
- Each row: title, company · place, source badge, "Applied 2 days ago" or "Not for me · Wrong seniority · 3 days ago", and a **Closed** badge when the job has closed _(applying to a job that later closes is normal)_.
- Same list-and-detail layout as Matches (detail as its own page at phone width). The detail adds:
  - On Applied: **Move to Not for me** and **Move back to Matches**.
  - On Not for me: the reason and note, **Edit reason**, **Mark applied** and **Move back to Matches**.
- **Move back to Matches** deletes the decision. The job reappears in Matches only if it still qualifies and is in the window; the button's confirm says so.
- Empty states: "Jobs you mark applied show here" / "Jobs you mark not for me show here".
- No paging at first. If the list grows past a few hundred rows, add paging then.

### `db:analyze`

A new section: "not for me" decisions in the last 30 days by reason. For each reason that maps to a rule, it shows the share of those jobs where that rule's check was `unknown` rather than `pass`. That separates "the matcher didn't know" from "the rule is wrong". It reads `matchSnapshot`, not the current matches. A job counts as `unknown` when any qualified match in its snapshot had that check `unknown`. Jobs with an empty snapshot are counted separately _(my calls)_. The report is read-only, like the rest of `db:analyze`.

### Roadmap

This is the first piece of Phase 5's tracking. In `docs/roadmap/README.md`, Phase 5 gains a line saying jobs can already be marked applied or not for me (this spec). Phase 2's slice 05 (Rejected view) is unchanged: it lists the engine's rejections, not the user's.

## Left to the builder

- The exact toast, dialog and empty-state wording.
- Whether the Applications switch is `tabs` or `toggle-group`, whichever `DESIGN.md` favors for a two-way switch.
- How the matches page drops decided rows: filter in `groupByJob`'s callers or in the loader. The counts must leave them out too.
- The seed data for local checks: a few applied and dismissed jobs, one closed, one whose profile was deleted.

## Done when

- A job marked Applied or Not for me leaves Matches and Review at once and shows on Applications under the right switch, on every device.
- It stays out of Matches after a rematch, a reprocess, a merge into another job and a revived merge, and it stays on Applications, still editable, after the engine rejects it, it closes, or its profile is deleted.
- A merge of an Applied job with a Not for me one keeps Applied.
- Not for me saves with no reason, with only a reason, and with a reason and a note.
- Undo, Move back to Matches, switching between Applied and Not for me, and Edit reason all work.
- Isolation tests prove one user can't read, insert, change or delete another user's decisions, or insert one for a job they have no match for.
- `db:analyze` shows the reasons section.
- The pages look right at 360px wide.
- CI is green.
