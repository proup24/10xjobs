# Phase 4 slice 04: Ingest and qualify LinkedIn posts

Date: 2026-11-25
Status: draft
Roadmap brief: [docs/roadmap/phase-4-social-posts/04-ingest-and-qualify.md](../../roadmap/phase-4-social-posts/04-ingest-and-qualify.md)

## Intent

Slice 03 turns each hiring post into one role job per role (`kind = 'post_role'`), each with a listing-shaped extraction. Nothing decides them yet: on 2026-11-25 dev holds 937 processed role jobs (771 engineering roles, 414 of them with a contact email) and not one `job_matches` row for them. This slice decides every role job against each profile that has post search on, as `qualified`, `review` or `rejected`, with the matcher's existing rules and reasons, so slice 04a can show them and slice 05 can email the qualified ones.

Slice 05 sends with no human step, so a qualified post becomes an email under the user's name. The owner chose to treat posts exactly like listings anyway: missing facts don't hold a post back _(user)_. The anti-goal "missing the right jobs" weighs as much here as "applying to the wrong ones".

## Goals

- Every processed, active role job is decided for each published profile with post search on, with the same checks, outcomes, `unverified` flag and reasons as a listing.
- Per-user blocked authors: a post by an author the user blocked is never a match for that user, and the decision says why.
- A share of an old post stops qualifying: the age of the original decides, not the share's.
- A role whose link points at a job we already hold (a LinkedIn job board listing or an ATS posting) is linked to that job. Applying to one, or marking one "not for me", counts for both.
- Post matches never appear among job-board matches, in the web app or in match webhooks.

## Non-goals

- The social posts sub-page, the blocked-authors page and the Junk and review lists (slice 04a).
- Sending email, and recording a sent email as an application (slice 05).
- Processor capacity: posts' share of the processor, the Claude subscription versus an API key, Apify credit. A separate credits and capacity brainstorm settles it, and **it must land before this slice ships** _(user)_.
- Following short links or opening apply pages to find a linked job. Only keys computable from the link text count.

## Anti-goals

- A post match mixed into the job-board matches, or a job-board match pulled out of its view because a post links to it.
- A post by a blocked author qualifying for that user.
- Applying twice to one job because it arrived as both a post and a listing.
- A rule that exists for posts only and drifts from the listing rules _(user: no post-specific rules)_.
- A post emailed before the user can see it. Post matches stay hidden until 04a's sub-page shows them, and slice 05 ships after 04a.

## Decided

Marked _(user)_ where the owner decided, _(proposal)_ where it was my proposal in the brainstorm and the owner accepted it, and _(my call)_ where I settled it while writing this up.

### Posts are decided like listings _(user)_

- Posts get no rules of their own and no stricter treatment. A fact the post leaves out is `unknown`, as for a listing. It never rejects on its own, and the decision comes out `qualified` with `unverified` set. On dev, 50% of emailable engineering roles state no seniority and 31% no arrangement. They qualify (unverified) when nothing else fails, and slice 05 may email them.
- The owner rejected the alternatives: sending these to review (about half of the emailable posts would never be emailed), and keeping the matcher as it is but never auto-emailing an unverified match.

### Which jobs and profiles take part

- **Matchable jobs** widen from `kind = 'job'` to `kind IN ('job', 'post_role')`. The other conditions stay: `status = 'active'`, `processingStatus = 'processed'`, not closed, within `MATCH_BACKFILL_DAYS`, and a current extraction of the matcher's schema version. One definition still serves the worker, the sweep and `db:rematch`.
- `processingStatus = 'archived'` is never matchable, and an archived role job's `job_matches` rows are deleted, by the archive itself or by the sweep (slice 03 carry-over). A post job (`kind = 'post'`) itself is never matched: its roles are.
- **Profiles:** a role job is decided only for published profiles with `postSearch` on _(slice 01)_. Turning post search off deletes that profile's role-job rows, through the sweep like other stale rows _(my call)_; turning it on backfills through the sweep, as for a newly published profile. Listings are decided for every published profile, as today.
- **Trigger:** the processor already finishes a role job `processed` with its extraction. It enqueues each written or reopened role job on the `match` queue, the same way it enqueues a processed listing. The sweep stays the safety net.

### Facts of a role job

- A role job's facts are built by `FactsService` from its role extraction alone. There's no LinkedIn listing, so every listing-sourced input is absent: places, workplace type, `expiresAt`, salary from the listing. Each is treated as the listing not stating it, and the description facts decide.
- **Posting language** reads the text the role was read from: the post's cleaned text and, for a share, the original's. It does not read a description the role job doesn't have _(my call)_.
- Closed facts follow the role job (a role that disappears from its post is archived, not closed).

### The checks added (they apply to every source, but only posts trigger them)

These are new checks in the matcher, not post-only rules. A listing always passes them with "nothing to check". They run in this order, after the existing checks.

1. **`hiringVerdict`**: reads the parent post extraction's verdict confidence. `unsure` fails as unsure, so the decision is at best `review` (rule `hiringVerdict`, field `verdict`) and never `qualified` _(slice 03, user)_. `sure` passes. A listing has nothing to check.
2. **`blockedAuthor`**: fails, sure, when any author of the post is on the user's blocked list. That covers the original's author and every sharer in `postSources`. The reason names the author: `you blocked <name>`. A listing has nothing to check. Checking sharers too is _(my call)_: a user who blocks a recruiter means none of that recruiter's posts, including reshares.
3. **`postAge`**: fails, sure, when the original post (the shared post for a share, else the post itself) was posted more than `POST_MAX_AGE_DAYS` (30) days before the decision. The reason is `posted <n> days ago`. A missing `postedAt` is `unknown`. A listing has nothing to check: listing age keeps working through `MATCH_BACKFILL_DAYS` and `expiresAt` _(proposal)_. On dev only 2 of 708 hiring post sources are shares and the median post is 2 days old, so this is a safety net. **Ageing takes effect without a new observation** _(my call, from the builder check)_: a role qualified on day 29 must not stay qualified, so the facts of a role carry the moment its original turns 30 days old, and the sweep re-decides the role once that moment passes, the way a passed `expiresAt` makes listing facts stale. Unlike a closed listing, the row is decided again (and comes out `rejected`), not kept as it was. Slice 05 still checks the age at send time.

Because a rejection needs only one sure fail, a blocked author or an old original rejects whatever else passes. Because the checks run with no early exit, the stored `checks` still show the whole picture.

### Tech lead roles _(proposal)_

A `tech_lead` profile fails position today on a role like "Tech Lead Fullstack", which Extract codes as `fullstack_engineer` because the kind follows the duties. The position check changes for every source: a `tech_lead` profile **passes** position when the job's role kind is any software engineering kind and its seniority is `lead` (or a seniority code that stands for leading a team; the builder confirms against the seniority vocabulary). The other profiles are unchanged, and an exact role kind still passes as before. Seniority is not touched: a `tech_lead` profile whose seniority set leaves out `lead` still fails seniority on a lead role, because the profile said so _(my call)_. The reason says so: `lead-level fullstack_engineer counts for tech_lead`. This changes listings too, so it ships with a `MATCHER_VERSION` bump and a `db:rematch -- --all`.

### Blocked authors, per user _(user, slice 02 brainstorm)_

- A new user-owned table `blocked_authors`: `userId`, `authorKey` (the same key Prepare uses: `profile:<publicIdentifier>` or `company:<universalName>`, lowercased), `profileUrl` (the LinkedIn link the user gave), an optional display `name`, timestamps, and unique `(userId, authorKey)`. RLS: owners select, insert and delete their own rows. The engine reads them all.
- The list covers all of the user's profiles _(user)_. Turning a pasted LinkedIn profile or company link into an `authorKey` is a shared function used by 04a's page and by tests here.
- **Re-deciding on a change:** any insert or delete bumps `users.eligibilityVersion`, with a trigger like the work-authorization ones. The sweep's existing staleness then re-decides that user's rows, listings included (they pass the check and keep their outcome). This reuses a mechanism that is already tested instead of adding a third version column _(my call)_.
- This slice adds the table, the trigger and the rule, and no UI. 04a adds the page. Until then the owner can insert rows by SQL to check the rule on dev.
- Slice 05 honours the list for emails. Because a blocked author's role is `rejected` for that user, slice 05 never sees it as qualified anyway.

### A role linked to a job we hold _(user: keep both, linked; approach A)_

- **The link is resolved when read, not stored as a pair** _(user, approach A)_. When a role job is written, the processor computes the job keys its links resolve to, using ingest's job-key code (`normalize/job-key.ts`): `ats:<provider>/<tenant>/<id>` for an Ashby or Greenhouse posting, `linkedin-job:<id>` for a LinkedIn `/jobs/view/<id>/` link, and `url:<canonical>` for another apply URL that carries an identifier. It stores them on the role job as `linkKeys text[]`, indexed. A role with no keyable link has an empty array.
- The linked job is any active job (`kind = 'job'`) whose `jobKey` is in the role's `linkKeys`, **or whose LinkedIn job id matches a `linkedin-job:<id>` key of the role** _(my call, from the builder check)_. Ingest keys a LinkedIn listing by its apply URL when that URL is an ATS posting or carries an identifier, so a post linking `linkedin.com/jobs/view/123/` would otherwise never find listing 123 when it applies off-site, which is common. The listing's LinkedIn id is read from its `postingUrl` (or its harvestapi source); the builder picks a column or expression index so the join stays indexed. A listing that arrives later, a re-key or a merge is picked up with no sync step, because ingest keeps both current.
- **Any jobs that share a key are linked, posts with posts too** _(user, from the builder check)_. Two recruiters' posts linking the same ATS posting are the same job even when no listing exists. A role links every active role job whose `linkKeys` overlap its own, and every listing that matches as above. The link is a group, transitive through shared keys: role A ↔ listing ↔ role B is one job. Slice 05 sends at most one email per linked group: the first qualified role wins, and the others list under Matches as already applied.
- **Both stay, each in its own view** _(user)_. The role job is decided and shown with the posts, and the listing with the job board. Neither is merged into the other or hidden. The owner accepts that one job can then appear in both views, as the exception.
- **A decision on one counts for both** _(user)_. A `job_decisions` row (applied, dismissed, expired) on either side is read as a decision on the other, wherever decisions hide a job from Matches or Review or list it in Applications. The row is written once, on the job the user acted on. Reading through the link keeps nothing to copy or keep in sync. For slice 05, an email sent for a role whose linked listing the user already applied to must not go out. Slice 05 reads the same link.
- **Applications lists decision rows, so a linked pair is one entry** _(my call)_: the decision lives on the job the user acted on, and the other copy is only hidden from Matches and Review. The shared read is one SQL function (job id and user in, the decisions of every job in its linked group out) used by the web's `match_details` and decision-list RPCs and by slice 05. This slice changes those RPCs; nothing shows yet because role jobs are filtered out until 04a, which also lets a user record a decision on a role.
- Showing the link ("also on the job board", "also posted on LinkedIn by …") is 04a's.

### Separate views _(user)_

- The owner decided: when post search is on, the matches page has sub-pages, one for job-board listings and one for social posts, never mixed. An emailed post shows in **Applications**, as an `applied` decision, not in a separate "Applied" tab. This changes 04a's and 05's briefs, updated with this spec.
- This slice ships before 04a's sub-pages. Until they exist, every reader of `job_matches` in the web app (matches, review, rejected, the job details page) and the match webhooks filter out role jobs, so today's views keep showing listings only. 04a then adds the posts sub-page on top _(proposal)_. Webhooks staying listing-only until 04a decides what a post webhook carries is _(my call)_.
- The owner and testers can read post decisions on dev through SQL and `db:analyze` until 04a ships.

## Approaches

**How posts are decided.**

- **Role jobs join the existing matcher (chosen).** One set of rules for both sources, plus three source-neutral checks that only posts trigger.
- A separate post matcher was rejected: it would copy every rule and let them drift, against the owner's "same rules as listings".
- Merging a post into the listing it links was rejected: it would pull the post out of the social posts view. The owner wants both kept, linked.

**How a role is linked to its job** _(user picked A)_.

- **A. Resolve on read (chosen):** store the role's link keys, join on `jobKey`, the listing's LinkedIn id and other roles' `linkKeys`. It's always current through re-keys, merges and late arrivals, with nothing to sync. The cost is a join wherever decisions are read.
- **B. A link table** written by the processor and re-checked by ingest on every new key. Links are explicit and easy to audit, but every re-key, merge and late listing must update the table, and stale links are where double applications would come from.

**Unknown facts on a post** _(user picked "same as listings")_. The alternatives were: a stricter matcher for posts (an unknown key fact sends to review), or one matcher with a stricter send (an unverified match is never auto-emailed). Both were rejected in favour of not missing posts.

## Constraints

- `MATCHER_VERSION` bump (new checks, tech lead) and `FACTS_VERSION` only if the facts document's shape changes for role jobs. After deploy: `db:rematch -- --all`.
- Contract changes in `libs/database/src/contract/contract.prisma` only, RLS included: `blocked_authors`, `normalized_jobs.linkKeys` with its index, and the `eligibilityVersion` trigger. Advance `app/refs/db.json` and regenerate `database.types.ts` (CI diffs it).
- The listing path's decisions must not change, except for `tech_lead` profiles under the new position rule. A rematch on dev is checked for that: the outcome counts of listing rows before and after differ only on `tech_lead` profiles.
- The matcher stays pure. The new checks take the verdict, the authors, the original's date and the blocked list as arguments, loaded by the repository.
- Shipping gate: the capacity brainstorm's fix is merged and live before this slice's PRs deploy, or post decisions run against a stalled processor.

## Left to the builder

- Where `linkKeys` is computed (the processor's role writer is the natural place) and how existing role jobs get theirs: a one-off backfill, or a `db:reprocess` of post jobs through extraction reuse with no model call.
- Whether `hiringVerdict` reads the verdict from the parent's current extraction at match time, or from a column copied onto the role. Facts staleness must notice when the parent is re-extracted.
- The exact seniority codes that count as lead for the `tech_lead` rule.
- Splitting into PRs. A natural split: (1) the matcher widening and the three checks, with the web and webhook filters in the same PR, so nothing leaks; (2) blocked authors; (3) links and shared decisions; (4) tech lead.

## Rollout check on dev

- After deploy and the rematch: every processed active role job has one row per profile with post search on, and none for other profiles; archived role jobs have none.
- Outcome shares for role jobs from `db:match-shares`, with `review` split by rule. An `unsure` verdict never shows as `qualified`.
- Listing outcome counts unchanged except on `tech_lead` profiles.
- A blocked author inserted by SQL for the owner turns their role rows `rejected` with the reason, and deleting it restores them.
- No role job appears on the web app's matches, review or rejected views, or in a webhook delivery.
- Count of role jobs with a resolved link, and a hand check of a few.

## Handed to later slices

- 04a: the posts sub-page, the blocked-authors page (and blocking from a post), showing linked jobs, the Junk and review lists, and post webhooks.
- 05: sending, recorded as an `applied` decision shown in Applications. Honour the linked group: at most one email per job, and never one about a job the user already applied to through a listing or another post, honour blocked authors, and rerun the post eval before sending.
- The capacity brainstorm, before this slice ships.
