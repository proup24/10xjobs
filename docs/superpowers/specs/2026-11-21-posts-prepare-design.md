# Phase 4 slice 02: Prepare LinkedIn posts

Date: 2026-11-21
Status: draft
Roadmap brief: [docs/roadmap/phase-4-social-posts/02-prepare.md](../../roadmap/phase-4-social-posts/02-prepare.md)

## Intent

Slice 01 stores raw LinkedIn posts. Before slice 03 sends posts to Claude, this slice cleans each one, merges exact duplicates, and drops what is near-certainly not a hiring post, with cheap rules and a recorded reason for every drop. The owner's Claude subscription quota is the main worry _(user)_; missing a right post is the anti-goal that bounds how far the filter goes. The owner can see every drop and silence junk authors engine-wide from a web page only they can open.

## Goals

- Every collected post becomes either a prepared post (a job row, `kind = 'post'`) or a drop with a reason naming the rule and the text it matched.
- Exact duplicates become one job: posts LinkedIn links together (plain reposts, shares) and posts by one author with the same cleaned text.
- Each prepared post carries a cleaned text, its author, its links sorted by kind, the email addresses in it, and, for a share, the sharer's added text and the original post's text, author and date.
- The owner has a read-only web page of drops and silenced posts, and can silence and un-silence authors there. Silenced authors' posts never reach Extract, for anyone.
- Drop rules ship only once they pass on a hand-labelled sample of real posts.

## Non-goals

- Extracting facts, the "not hiring" verdict, the quota guard on extraction (slice 03).
- Matching, the social posts page, per-user blocked authors (slices 04 and 04a).
- Emails (slice 05).
- Following `lnkd.in` short links: no network calls in Prepare. Extract sees them as written.
- Reading text inside images or attached documents.
- Fuzzy or near-duplicate merging.

## Anti-goals

- Dropping a real hiring post. A rule that would drop one in the labelled sample doesn't ship.
- Merging two different roles into one job (e.g. one company's template posted twice with different titles).
- Silencing a real recruiter for good without the owner noticing.

## Decided

Marked _(user)_ where the owner decided, _(proposal)_ where it was my proposal and the owner accepted it without changing it, and _(my call)_ where I settled it while writing this up.

### Shape: Prepare is the post normalizer (approach 1, _user_)

- Prepare is the `LINKEDIN_POSTS` mapper in `apps/xjobs/src/modules/ingest/normalize/`, today missing (`normalize: linkedin_posts is not normalized`). It stays pure and deterministic like the other mappers: no network, no database.
- **A kept post** is a valid `NormalizedVersion` and, through the existing job merging, a `NormalizedJob` with `kind = 'post'`.
- **A drop** is an invalid `NormalizedVersion` whose `reason` is `prepare: <rule>: "<matched text>"` (the snippet trimmed to about 80 characters, _my call_). Nothing else is needed to find a wrong drop.
- **Fixing a rule** means changing it, bumping `NORMALIZER_VERSION` and running `db:renormalize`, which rebuilds every post from raw storage. `renormalize.service.ts` excludes `LINKEDIN_POSTS` today; this slice includes it _(proposal)_.
- Post jobs are already outside the processor's and matcher's scope (both read only `kind = 'job'`, `processor.repository.ts`, `matcher.repository.ts`), so no post reaches Claude until slice 03 opens that scope. This slice must not change it. Post jobs are created with no processing status (null, not `pending`), so they don't pile up in the processor's counts; slice 03 decides how they enter its queue _(my call)_.
- Ingest stores posts raw only today (`saveItem` in `raw.repository.ts` skips linking for posts); this slice links them like job-board items.
- **A post that was kept and later becomes a drop** (a new rule plus a renormalize, the normal case since rules ship after post jobs exist): for posts only, the item leaves its job, and a post job left with no sources gets processing status `archived`. A drop that is later un-dropped links again on renormalize, into its old job or a new one. Job-board items that turn invalid keep today's behaviour _(my call)_.

### What Prepare keeps from each post (_proposal_)

- The raw payload stays untouched in raw storage.
- **Cleaned text** (`descriptionText`): the "…see more" leftovers removed, emoji removed, whitespace tidied, hashtags kept as plain words (`#reactjs` → `reactjs`), mentions kept as names. Its job is to be readable by Extract and comparable for duplicates, not pretty.
- **Author** (`poster`): name, profile URL, person or company page. The headline is kept too: it says "Recruiter at X" or "Open to work", which rules and the review page use.
- **Links, sorted without Claude:** email addresses; LinkedIn job board links (`linkedin.com/jobs/view/<id>`, with the id); Ashby and Greenhouse postings (the engine's existing `atsIdentity`); other links. Short links stay in "other", as written.
- **For a share:** the sharer's added text, and the original post's text, author, URL and posted date. The original's date is recorded, never used to drop _(user: no recency rule)_.
- Where this lives is left to the builder: the listing-shaped record has no place for it, so a nullable `post` object on the record (required when `kind = 'post'`) and a matching `jsonb` column on `normalized_jobs` is the expected shape. `postedAt` comes from the post's own date, as the README already says.

### Exact-only duplicates (_user_)

Two posts are the same job only when:

1. **LinkedIn links them:** a plain repost or a share of an original. The job key is the original's key, so the repost or share joins the original's job.
2. **Same author, same cleaned text:** e.g. "reposting for visibility". The job key is a fingerprint of the original author and the cleaned text.

So a post's job key is `linkedin-post:<fingerprint of original author + original cleaned text>` _(my call)_, which covers both cases with one rule, since a repost carries its original's author and text. The author is part of the key because two people posting the same short generic text ("We're hiring! #react") are not the same job; copy-pasted announcements by different recruiters stay separate and cost one extra Extract call. When the original's cleaned text is shorter than a minimum (the builder picks it, about 100 characters), the key is the **original's** id instead (the post's own id for an original), so short image posts never merge by text but a plain repost of one still joins it. If the payload has no original id, it falls back to the post's own id _(my call)_.

- A lightly edited repost is a new job. It may show twice and costs one Extract call. It never sends a second email, because slice 05's rule is one email per user per address and role _(user)_.
- **A share with added text joins its original's job, and keeps its added text.** The job carries every source's added text. When a share adds text to an already-prepared job, the job is sent back to Extract (the existing `joined` processing reason) once slice 03 exists _(proposal)_.
- The job key changes from today's `linkedin-post:<id>` (README, `job-key.ts`); no post job exists on dev yet, so nothing is re-keyed _(my call)_.

### The filter: near-certain junk only (_user_)

- A drop rule is allowed only for posts that cannot be a hiring post. Anything uncertain goes to Extract: "we're hiring" with no role, other languages, no email and no apply link, image-only announcements with some text.
- **Candidates**, to be confirmed on real posts _(proposal)_:
  - the author is looking for work ("open to work", "I'm looking for my next role", "#opentowork");
  - course, bootcamp or training ads;
  - job digests that only list links to other jobs.
- **A post with no text at all** (cleaned text empty, no share text) is dropped as `prepare: no-text` _(my call)_: Extract reads text only, so it has nothing to read.
- **No recency rule** _(user)_: collection already asks for posts from the last 24 hours at most; an old shared original is recorded and left to the matcher (slice 04).
- **Rules judge the original post, never the sharer** _(my call)_: a plain repost or a share is dropped only when its original would be. A job seeker sharing a real hiring post must not drop the only copy we have. `no-text` likewise drops a share only when both the added text and the original are empty.
- **No other rules without data:** no language, technology or role-word rules _(user: drop only near-certain junk)_.

### Shipping a rule: the labelled sample (_proposal_)

- No drop rule ships until it drops **zero** posts labelled as hiring in a sample of about 100 to 150 real posts, and its matches are listed with the posts it would drop.
- **Getting the sample:** the owner raises the Apify limit so post collection runs (stopped since 2026-11-20 14:10 UTC); one day gives about 500 posts for the owner's profile. A read-only script exports a random sample of prepared posts (cleaned text, author headline, links) to a file _(my call)_.
- **Labelling:** Claude pre-labels each post (hiring, not hiring, unsure) and the owner confirms them in a session, as with the processor's golden labels _(my call)_. `unsure` counts as hiring for the zero-drop bar.
- **Where the sample lives** _(user)_: as test fixtures in the repo, as collected, with no scrubbing (the posts are public), and a Vitest spec that runs every rule over them and fails when a rule drops a post labelled hiring or unsure. The spec is the gate in CI.
- The plan therefore orders work so the rules come last: the cleaning, keys, silencing and review page can be built and deployed before any real post exists.

### Silenced authors, engine-wide (_user_)

- An engine-only table of silenced authors (RLS on, no policies): the author's identity (LinkedIn profile URL or id, the builder picks the stable one from the payload), name as last seen, a reason, how it got there (`manual` or `automatic`), who added it and when.
- **Silencing happens after Prepare, not in it:** the mapper must stay pure, and a silence change must not need a renormalize. A post job is silenced when every one of its sources' authors is silenced (for a share, the sharer) _(my call)_, so a real recruiter's post shared by a silenced aggregator stays live when the original was also collected.
- **Silenced is derived, not stored:** the check is a query (a repository method or SQL view) that slice 03's processor scope must exclude. Un-silencing therefore needs no clean-up. Slice 03 extracts only posts first seen within the last 7 days _(my call, a slice 03 requirement)_, so un-silencing brings back about a week of posts, as agreed.
- **Manual:** the owner silences from the review page, with a reason, and un-silences there.
- **Automatic** _(user)_: defined here, switched on in slice 03 once Extract gives a "not hiring" verdict. Proposed threshold, to tune on real data: at least 10 posts over at least 7 days, every one judged not hiring by Extract, none ever qualified for any profile. Automatic entries show on the review page with that evidence.

### The owner's review page (_user_)

- **Only the owner sees it**, read-only apart from silencing. There is no admin notion in the web app today; an engine setting `ADMIN_USERS` (Supabase user ids, empty by default) decides it, like `POST_SEARCH_USERS`, and the engine answers 403 to anyone else _(my call)_. The web app shows the page's link only to admins.
- **It lists**, newest first: dropped posts (rule, matched text, author and headline, posted date, link to the post); posts held because their author is silenced; and the silenced authors with their reason, origin and evidence. Filter by rule.
- **Actions:** silence an author (from any listed post) and un-silence. Nothing else changes from this page; a wrong drop is fixed in the rule.
- Built from `components/ui` and theme tokens per `apps/web/DESIGN.md`, calling new engine endpoints. Route, endpoint and component names are the builder's.

## Approaches

1. **Prepare as the post normalizer** _(user: chosen)_. The mapper cleans, sorts links, picks the job key and applies the drop rules; drops are invalid normalized versions with reasons; duplicates merge through the existing job merging; rule fixes replay with `db:renormalize`. Silencing is a derived check between Prepare and Extract, since the mapper stays pure. The cost: post jobs exist before Extract, which is the roadmap's suggested direction anyway.
2. **A separate prepared-posts table and worker step** after ingest. Posts stay out of `jobs` until Extract, but it duplicates versioning, merging and replays, and slices 03 or 04 still have to make jobs from posts, so post identity would be decided in two places.
3. **A pre-check inside Extract.** Cheapest to write, but it can't be built or checked before slice 03, so there'd be no drop review until then.

## Constraints

- The Prisma contract is the only schema source; the migration ref hash in `app/refs/db.json` must advance, and `database.types.ts` is regenerated (CI diffs it).
- `NORMALIZER_VERSION` bumps on any mapper or job-key change, followed by `db:renormalize` on dev.
- Mappers are pure: no network, no database, no clock beyond `scrapedAt`.
- The actor's post payload fields are not documented in the repo and the slice 01 probe payloads are gone. Field names (text, author, urn, share/repost reference, headline) must be read from the first real batch before the mapper is finished; the builder writes `docs/actors/harvestapi-linkedin-post-search.md` from it. A plain repost or share might not carry its original's id; if it doesn't, case 1 of the duplicates falls back to case 2 (same author and text of the original, when the payload has them).
- Real posts need the Apify limit raised by the owner.

## Left to the builder

- Field names in the actor's payload, and the stable author identity.
- The `post` object's exact shape and column, and how merging fills it across sources (added texts are a union, not "first non-null").
- The fingerprint (hash and text normalisation for comparison) and the minimum text length.
- The sample export script's name and file format.
- Route, endpoint and component names for the review page; pagination.

## Rollout check on dev

Once collection runs again:

- Post batches produce post jobs; no post job is claimed by the processor.
- A plain repost and an identical "reposting" post by the same author land in their original's job; a share keeps its added text.
- The review page opens for the owner only (another user gets 403 from the engine and no link).
- Silencing an author lists their posts as held; un-silencing lists them as live again.
- After the rules ship: every drop over the first day is read on the review page, and any wrong drop gets its rule fixed and a renormalize.

## Handed to later slices

- **Slice 03:** exclude silenced posts and posts first seen more than 7 days ago from extraction; give the "not hiring" verdict; switch on automatic silencing; re-extract a job when a share adds text; a quota guard on post extractions.
- **Slice 04:** weigh a shared original's age; decide whether a post linking a listing or ATS posting joins it (the sorted links are there).
- **Slice 05:** one email per user per address and role, which is what makes exact-only merging safe.
