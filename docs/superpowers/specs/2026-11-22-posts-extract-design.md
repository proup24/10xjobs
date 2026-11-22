# Phase 4 slice 03: Extract LinkedIn posts

Date: 2026-11-22
Status: draft
Roadmap brief: [docs/roadmap/phase-4-social-posts/03-extract.md](../../roadmap/phase-4-social-posts/03-extract.md)

## Intent

Slice 02 turns collected LinkedIn posts into prepared post jobs and drops only near-certain junk. This slice is the step that decides what is a real job. One Claude call reads each prepared post. It rules the post **hiring**, **not hiring** or **junk**, with a quoted reason. For a hiring post it pulls out each role's facts in the shape the matcher already reads, plus what only posts carry: how the author asks people to apply, the contact email and the employer.

The owner calls this the most important slice of the phase _(user)_. Users should apply only to proper jobs they fit, and post authors must never be spammed. Slice 05 emails a qualified post's address with no human step, so Extract's verdict and its contact email are the last automatic checks before an email goes out under a user's name. A wrong "hiring" costs an email that can't be unsent. A wrong "junk" hides a right job. The Junk view exists so the second kind of mistake gets seen and fixed.

## Goals

- Every prepared post in scope gets one extraction: a verdict with a reason and a quote, and for a hiring post one or more roles with their facts and how to apply.
- **A post that names several roles becomes one job per role** _(user)_. Each role job has its own listing-shaped extraction, so slice 04 matches it with the matcher's existing rules and reasons.
- Not-hiring and junk posts are kept with their verdict, never deleted, so users can see them in a Junk view (laid out by slice 04a) and the owner can confirm them _(user)_.
- The contact email is an address the post offers as the way to apply, never one that merely appears in it.
- Post extractions are limited by a daily cap the owner sets, and their calls and estimated cost per day can be seen.
- A golden set of real posts and an eval whose bars must pass before slice 05 sends anything automatically.
- Automatic silencing of authors whose posts keep being ruled not hiring or junk, built here and switched on once the owner has watched the verdicts (see "Automatic silencing").

## Non-goals

- Matching role jobs against profiles, and per-user blocked authors (slice 04).
- The social posts page and its Junk tab (slice 04a). This slice stores what that tab shows.
- Writing or sending the email (slice 05).
- Following `lnkd.in` short links, opening apply links, or reading text in images and documents. Extract reads the post's text and Prepare's sorted links only.
- Changing the listing extraction: its prompt, schema version, reuse keys and eval stay as they are.

## Anti-goals

- A not-hiring or junk post ruled hiring with a contact email: it would send an email.
- A contact email that is not the address the post gives for applying: a wrong email, or one to a press or support inbox.
- A guessed fact: a contact email, employer, role or place the post doesn't state.
- A real hiring post buried as junk with nobody able to see it.
- Post extraction using so much of the subscription that listings stop being processed or the owner's own Claude use runs out.

## Decided

Marked _(user)_ where the owner decided, _(proposal)_ where it was my proposal in the brainstorm and the owner accepted it, and _(my call)_ where I settled it while writing this up.

### Shape: the processor reads posts too (approach A, _user_)

- Post jobs join the processor. Claiming, retries, pauses on usage limits and the weekly reserve, the attempt log, extraction reuse, `db:reprocess` and the eval harness are shared with listings.
- What differs for posts: the prompt, the document schema, the input, the validation, the scope (below) and the daily cap. The listing path must stay byte-for-byte unchanged: its prompt hash and schema version don't move, so no listing is re-extracted.
- One `claude -p` call per post (per try), with the processor's isolation (no tools, empty home, stripped environment), model (`PROCESSOR_EXTRACTION_MODEL`, Sonnet 5.5 today) and effort.

### Scope: which posts are read

A post job is in the processor's scope when all of these hold:

- `kind = 'post'` and `status = 'active'`;
- it was first seen (the job's creation) within the last 7 days _(slice 02)_;
- it is not silenced: slice 02's `silencedPostJobSql` (`ingest/repositories/silenced-authors.repository.ts`), applied **after** the 7-day filter, with its query plan checked on dev data _(slice 02 brief)_.

Post jobs today have a null processing status. New post jobs from Prepare are set `pending` like listings, and the ingest worker nudges the `process` queue for post batches too. The 496 existing post jobs are sent once with `db:reprocess -- --null-status`. Out-of-window ones are left alone because they're out of scope _(my call)_.

**Re-extraction when a share adds text** _(slice 02)_: when a share joins an existing post job and brings added text, the job goes back to `pending` with the existing `joined` reason. The added text may hold the only contact email, or say the role is filled. The new input has a new hash, so it costs one call, which counts against the cap. For posts, `joined` must **not** use the listing path's joined reuse (`findJoinedReusable`, which copies an extraction of a different input with no call), or the new text would never be read. Post reuse is by the exact reuse key only _(my call)_.

### The input

The post input is built from the job's `post` sources (`PostDetail` in `ingest/normalize/record.ts`):

- the original post's cleaned text, author (name, headline, person or company) and posted date;
- every sharer's added text, with each sharer's name and headline;
- Prepare's sorted links: email addresses, LinkedIn job ids, Ashby and Greenhouse postings, other links;
- whether a text was cut at "see more" (`truncated`).

Its hash is the reuse key's input part, as for listings. Key order and normalisation are the builder's, using the existing `canonical` helper.

### The verdict _(user)_

Every post gets exactly one verdict, with a reason code, a quote and a confidence:

| Verdict      | Meaning                                                                       | Reason codes _(my call; the builder may refine them)_                                                                                             |
| ------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hiring`     | A real opening at an identifiable employer, or an agency recruiting for one   | `hiring`                                                                                                                                          |
| `not_hiring` | The second line behind Prepare: no opening is offered                         | `open_to_work`, `advice_or_commentary`, `course_or_training_ad`, `job_digest`, `role_filled`, `other`                                             |
| `junk`       | Says it's hiring, but it's an aggregator or lead-gen post, not a real opening | `no_clear_employer`, `many_roles_across_companies`, `funnel` (courses, training, placement fees), `messaging_group` (WhatsApp, Telegram), `other` |

- **Junk is dropped, not deleted** _(user)_. A junk or not-hiring post makes no role jobs, so it is never matched or emailed. Its verdict, reason and quote are stored on its extraction for the Junk view.
- The owner's examples set the bar for junk _(user)_. In slice 02's labelled sample (`ingest/normalize/posts/sample/sample.json`, notes starting `owner:`), these are junk or not hiring: #16 (35+ generic IT roles, sells courses), #63 (job-search advice plus a company digest), #81, #86, #106. #11 (300 openings, unnamed company) is junk, #13 (WhatsApp link) is junk, and #32 (an agency listing many roles across companies and places) is junk. The prompt describes these signs, and the golden set holds these posts with these verdicts.
- **A real role posted by a third-party recruiter** is `hiring`. The employer may be unnamed ("my client"), but it must be one role or a few at one employer. A list across several companies is `many_roles_across_companies` _(my call, from #32)_.
- **A non-software role** (IT support, sales) is `hiring`. Whether it suits anyone is the matcher's call (`isSoftwareEngineeringRole`), as for listings.
- **"Role filled"** in a sharer's added text or the original is `not_hiring` / `role_filled`. It never counts toward automatic silencing, because the author was hiring _(my call)_.
- **An unsure verdict is its own pipeline** _(user)_. The post supports two readings, e.g. hiring or junk, and it is handled like the job board's `review` outcome:
  - It is **not a match** and is **never emailed**. It shows in a review list of its own on the social posts page.
  - Its role jobs are still made, so the facts are there to read. Slice 04 gives a role job whose post verdict is unsure `review` at best: one that would qualify becomes `review`, and one the matcher rejects stays rejected with its reason.
  - The verdict's confidence is stored on the post extraction and is readable from each role job, separately from `needsReview` _(my call)_. The matcher's `needsReview` only marks a `qualified` decision `unverified` (`matcher/rules/decide.ts`), and changing that would move listing decisions too.
  - Slice 05 must refuse to send for a role job whose post verdict is unsure, whatever the match outcome, as a second lock.
  - Like the job board's review, it must stay the exception (see bar 3).

### Roles: one job per role _(user)_

- A hiring post's document lists its roles, one entry per distinct role the post offers. "Two senior backend engineers" is one role. "A backend and a frontend engineer" is two.
- **Each role entry has exactly the listing extraction's facts** (`schema/extraction.ts`: position, seniority, openings, stack, contract, salary, languages, work authorization, junk flags), so the matcher reads it unchanged. A fact the post doesn't state is `null` or `unstated`, as for listings. A post states far fewer facts than a listing; that is expected and is slice 04's concern.
- **Role jobs.** After a hiring extraction is saved, each role becomes a job linked to its post job. The role job's current extraction is a listing-shaped document holding that role's facts. Role jobs are what slice 04 matches. The post job holds the post-level extraction and is never matched itself.
- **Stable across re-extraction.** When a post is extracted again (a share added text, a prompt change), a role that is still there keeps its job, and so its matches and decisions. A role that is gone has its job archived. Matching old to new roles by normalised title is the expected rule; the builder settles ties _(my call)_.
- **When the post job is archived** (its last source became a Prepare drop), its role jobs are archived too.
- **A not-hiring or junk verdict on re-extraction** archives the post's existing role jobs.
- How role jobs are stored (a new `kind`, a parent link column, the job key) is left to the builder. Constraints: the matcher's and listing processor's existing `kind = 'job'` scopes must not pick role jobs up in this slice (slice 04 opens matching), role jobs are never claimed for extraction themselves, and the contract and RLS rules apply.

### How to apply and the contact email

Each role carries how the author asks people to apply. A post usually gives one way for all its roles, and the prompt says so, but a role may differ ("backend: email…, frontend: apply here").

- **Kinds** _(user)_: `email`, `external_link` (an ATS posting or careers page), `linkedin_job` (a LinkedIn job board link), `connect_dm_comment` ("DM me", "comment 'interested'", "connect with me"), and `unstated` _(my call: a hiring post with no stated way, shown as a match to act on by hand)_. Several kinds can hold at once (an email and an apply link). Slice 05 sends only when `email` is one of them, and slice 04a lists the rest.
- **The contact email is the apply address only** _(proposal)_. It is recorded only when the post offers it as the way to apply or ask about the role ("send your CV to…", "reach me at…"), with a verbatim quote showing that. Other addresses (press, support, a signature unrelated to applying) are not contact emails.
- **Hard checks, in validation, not trust** _(my call)_:
  - the contact email must be one of Prepare's `links.emails` for the job (compared lower-cased), and its quote must be verbatim text of the input;
  - an external or LinkedIn link must be one of Prepare's sorted links;
  - a document that breaks either is invalid and retried like any invalid generation.
  - Nothing is ever composed or guessed, e.g. from the author's name and company domain.
- **A truncated post** (cut at "see more") may hide its email. Extract records only what it can see. If no way to apply is visible, it is `unstated` _(my call)_.

### The employer

Each role records its employer as the post states it, with a quote: a company name, or null when unnamed. It also records how the author relates to that employer: `employer` (they work there or it is the company page), `recruiter` (an agency or freelance recruiter, named client or not), or `unstated` _(my call)_. Slice 05 uses the employer and role title to tell a new role from a repost of one already emailed. The employer is never filled from the author's headline alone unless the post says the author is hiring for their own company ("we're hiring" by a "CTO at Acme" counts).

### Daily cap and the measure of cost

- **`POST_EXTRACTION_DAILY_CAP`**: the most post extraction calls started per UTC day, separate from `PROCESSOR_DAILY_BUDGET_USD`. When it's reached, posts stay `pending` and listings carry on _(proposal)_. The default is 250 _(my call: about half of a day's collection for the owner, before Prepare's drops; the owner tunes it)_.
- **Over the cap, newest first** _(proposal)_. Pending posts are claimed newest first (most recently first seen), so fresh posts beat a backlog. A post that waits past the 7-day window leaves scope and is never extracted. That loss is visible in the status counts (below).
- The weekly reserve (`PROCESSOR_WEEKLY_STOP_AT`) and usage-limit pauses apply to posts as to listings. Neither may starve listings: posts and listings share the worker's concurrency, and the builder picks the interleaving. The plain rule is that a post never jumps ahead of a listing that has waited longer than a set time.
- **The measure** _(my call)_: `GET /processor/status` reports posts and listings separately: pending, processed, failed and out-of-window counts; today's post calls against the cap; and today's estimated post cost. The same figures per day for the last 7 days go into `db:analyze`. Both read `processing_attempts`, so the attempt row must record whether it was a post call.

### Automatic silencing

- **Whose author counts** _(my call)_: a verdict counts against the **original post's author** only, never a sharer's. The verdict judges the original, just as Prepare's rules do, so a recruiter who reshares an aggregator's post isn't silenced for it, and the aggregator is. This differs from `silencedPostJobSql`, which holds a job only when every source's author is silenced. That's fine: the evidence is about who wrote the junk, and the hold is about not hiding a post someone else shared.
- **The rule** _(slice 02, to tune)_: an author is silenced automatically when they have at least 10 extracted posts over at least 7 days, every one ruled `not_hiring` or `junk`, with `role_filled` not counting, and none ever qualified for any profile. Until slice 04 matches posts, "never qualified" holds trivially.
- The evidence (post count, first and last date, verdict counts) goes in `silenced_authors.evidence` with `origin = 'automatic'`, and shows on the owner's review page.
- **Built here, off by default** _(my call)_. A setting (`POST_AUTO_SILENCE`, off) switches it on. It stays off until the owner has watched the verdicts for about a week and agrees with them. A wrong silence is engine-wide and hides that author's real posts from everyone. While it's off, a daily dry run logs who would have been silenced, so the owner can check the threshold first.

### Watching the verdicts before slice 04a _(my call)_

The users' Junk tab is slice 04a's, but the owner needs to see verdicts from the first day, to confirm the junk and to decide on automatic silencing. The owner's existing review page (`/admin/prepare`, gated by `ADMIN_USERS`) gains a list of extracted posts ruled `not_hiring` or `junk`, newest first. Each row shows the verdict, reason code, quote, author and headline, and a link to the post, with a filter by verdict and reason, and the would-be automatic silences. It is read-only apart from the existing silence actions. A wrong verdict is fixed in the prompt and the golden set, then the post is re-extracted. There is no per-post override _(proposal)_.

### The golden set and the bar for slice 05 _(user)_

- **The set**: slice 02's 150 labelled posts. Before the eval counts, the owner confirms the 70 hiring labels still unreviewed. For each post the golden case records the verdict. For hiring posts it also records the roles, each role's facts, how to apply, the contact email and the employer. Claude pre-labels and the owner confirms in a session, as for the processor's golden set and the slice 02 sample _(my call)_. Owner notes become verdict labels as listed above, so #11, #13 and #32 are junk. More real posts may be added later. A post added later needs a confirmed label before it counts.
- **The eval**: `processor:eval` runs the post golden set as a separate suite (a flag or a sibling command, the builder's choice), with the same in-memory, no-database, stop-on-usage-limit behaviour. Its report sits beside the listings report.
- **Bars before slice 05 may send automatically** _(user)_:
  1. **No wrong sends**: zero posts labelled not hiring or junk come out hiring with a contact email.
  2. **The right address**: on every hiring post that has a labelled contact email, the extracted contact email is exactly it (100%). An extracted email where the label has none also fails this bar.
  3. **Real posts kept**: at least 95% of posts labelled hiring come out hiring with a sure verdict. An unsure verdict is not a match, so on a real post it counts as a miss. That keeps a hedging prompt from passing _(user: unsure is its own pipeline; how it scores is my call)_. An unsure verdict on a post labelled not hiring or junk fails no bar, but the report counts unsure verdicts by label.
  4. Role facts are scored with the processor's existing fact bars where they apply.
- An unreviewed label fails the bars, as for the processor's golden set today.
- **When the labels must be confirmed** _(my call)_. The verdict and contact email labels for all 150 posts are confirmed in this slice, since the prompt is tuned on them. Role facts labels are confirmed in this slice too, but the slice can ship extraction and the owner's verdict list before the bars pass. Only slice 05 is gated on the bars. Which labels count as confirmed: the 70 unreviewed hiring labels are those recorded as pre-labels in slice 02's labelling session. The sample file has no "reviewed" marker, so the label session adds one per post.
- Slice 05's brief records the bar as its gate: no automatic sending until the post eval passes on the current prompt, schema and model.

## Approaches

1. **Reuse the processor with a post prompt** _(user: chosen)_. Posts join the processor's scope, one call per post, with a post document (verdict, how to apply, roles in the listing shape). The proven claim, pause, reuse and eval machinery is shared. The cost is a second document type in the processor, which needs care to leave the listing path unchanged.
2. **A separate post extractor module** with its own queue, prompt, schema and eval, borrowing only the `claude -p` runner. Cleaner to read, but it duplicates claiming, pauses and failure handling, and two consumers of one subscription would have to agree on pauses anyway.
3. **A cheap triage call, then a full extraction for hiring posts.** It saves quota on junk, but a hiring post costs two calls. The saving is small after Prepare's drops (about a third of the raw sample was not hiring or junk), and the most important ruling would come from the weakest model.

## Constraints

- The Prisma contract is the only schema source. Advance the migration ref hash in `app/refs/db.json` and regenerate `database.types.ts` (CI diffs it).
- Listing extractions must not change: the same prompt hash, schema version and reuse keys. `processor:eval` on listings must give the same result.
- Shared processor tables stay shared and engine-only (RLS on, no policies). A post is public text and carries nothing about any user.
- The engine shares the owner's subscription. Today listings take about 940 calls a day at about $0.04 estimated each (dev, last 7 days). Posts would add up to about half as much again before the cap.
- Post facts are untrusted text read by an isolated call, as for listings.

## Left to the builder

- The post document's exact schema (a new document type with its own version), and how the listing role facts nest in it.
- How role jobs are stored and keyed, the parent link, and the title-based role matching on re-extraction.
- The post input's exact layout and the prompt's wording, within the rules above.
- How posts and listings interleave on the worker, and the "waited too long" threshold.
- The eval command's form, the golden case format for posts, and the report's layout.
- The admin list's layout and pagination, from `components/ui` per `apps/web/DESIGN.md`.

## Rollout check on dev

- New post jobs go `pending` and are extracted. `db:reprocess -- --null-status` sends the in-window backlog. Out-of-window and silenced post jobs are not claimed.
- Listings keep being processed while posts run. When the cap is reached, posts wait and listings don't.
- A multi-role post gives one role job per role. A junk post gives none, and shows on `/admin/prepare` with its reason.
- Every contact email is in its post's text. Spot-check 20 against the post.
- The status endpoint shows post calls and estimated cost for the day. After a few days, compare the real calls per day with the cap.
- After about a week of watching verdicts, the owner decides whether to switch on `POST_AUTO_SILENCE`, using the dry-run log.

## Handed to later slices

- **Slice 04:** match role jobs. A role job whose post verdict is unsure gets `review` at best, and is never a match; decide how a post's often-missing facts are treated, given that a match can send an email.
- **Slice 04a:** a review list for posts with an unsure verdict, apart from Matches. Also the users' Junk tab next to Matches and Disqualified, listing the not-hiring and junk posts collected by the user's searches, with verdict and reason. Open there: whether it also shows Prepare's drops, which today only the owner sees.
- **Slice 05:** the post eval's bars are its gate. Never send for a role job whose post verdict is unsure. One email per post per user, naming the role that matched. Telling a new role from a repost uses each role's employer and title.
