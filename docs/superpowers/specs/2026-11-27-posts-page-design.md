# Phase 4 slice 04a: Social posts page

Date: 2026-11-27
Status: draft
Roadmap brief: [docs/roadmap/phase-4-social-posts/04a-social-posts-page.md](../../roadmap/phase-4-social-posts/04a-social-posts-page.md)

## Intent

Slice 04 decides every post role job (`kind = 'post_role'`) for each published profile with post search on, and hides the results from the web app and from webhooks until this slice gives them a view. This slice is that view: a **Social posts** sub-page of Matches, apart from job-board listings, where each user sees every post that matched them, the posts that were disqualified, and the posts Extract threw out as junk, and can pull a valuable post back out by hand. It also gives each user the blocked-authors list in Preferences and sends post matches to the user's webhook.

Slice 05 will email qualified posts automatically, under the user's name. This slice is where the user first sees those posts, so it must show which ones are waiting for an email, and nothing may be emailed that the user could not see first.

The anti-goals that weigh most here are "missing the right jobs" (hence the Junk and Disqualified tabs, open to every user) and "spamming post authors" (hence rescued posts are never emailed, and post webhooks wait for the email outcome).

## Goals

- With post search on, Matches has two sub-pages, **Job board** and **Social posts**, never mixed _(user, slice 04)_.
- Social posts has four tabs for every user: **Matches**, **Review**, **Disqualified**, **Junk** _(user)_.
- Each post shows its role facts, why it matched or failed, the original post (and a sharer's text), the author, how to apply, and its age.
- A user can **rescue** a post from Junk or Disqualified. The rescue puts it in Matches for that user only, by hand, never emailed, and files a report so the system can be fixed _(user)_.
- An emailable qualified post shows in Matches with an **Email pending** badge until it is actually sent _(user)_.
- Per-user **blocked authors** in Preferences, and blocking straight from a post.
- Post matches go to the user's webhook, marked as social posts; an emailable one only after its email settles _(user)_.

## Non-goals

- Sending email, Gmail, the send queue and its record (slice 05). This slice only shows "Email pending" and holds the webhook.
- Prepare's drops (open-to-work, bench-sales lists) and silenced authors: they stay owner-only on `/admin/prepare` _(proposal, accepted)_.
- Separate pages for other sources (Indeed, ATS): later.
- Fixing Extract or the matcher from rescue reports: this slice records the reports and lets the owner read them.
- Opening post search to every user (slice 04b).

## Anti-goals

- A post match among the job-board matches, or the reverse.
- A rescued post emailed, or re-decided away from the rescuer's Matches.
- A rescue that changes what any other user sees.
- A post emailed that the user never had the chance to see, or a webhook that says "apply by hand" for a post that is later emailed.
- A blocked author's post in the user's Matches.

## Decided

Marked _(user)_ where the owner decided, _(proposal)_ where it was my proposal in the brainstorm and the owner accepted it, and _(my call)_ where I settled it while writing this up.

### Where it lives

- **The switch.** When at least one of the user's profiles has post search on, the top of Matches shows `Job board | Social posts`. Job board is today's page at `/`, unchanged except that it never shows post roles. Social posts is its own route, `/posts` _(my call)_, so its URL state (tab, profile, window, open job) doesn't collide with the job board's. With post search off on every profile, there is no switch and `/posts` redirects to `/` _(proposal)_.
- The sidebar's **Matches** item is active on both sub-pages _(my call)_.
- The posts page reuses the matches list, filters, detail and decision components, with a post section in the detail _(my call)_. It follows `apps/web/DESIGN.md`: only `components/ui` and theme tokens.

```
Matches   [ Job board | Social posts ]

Social posts
  Matches 12 · Review 3 · Disqualified 41 · Junk 18
  [ Backend (Go) ▾ ]                 [ 24h | 7d ]
  ┌───────────────────────────┐ ┌────────────────────────────────┐
  │ Senior Go engineer · Acme │ │ Senior Go engineer · Acme      │
  │ Email pending · 2d        │ │ Posted 2 days ago by Jane Doe ↗│
  │ Backend lead · Foo        │ │ How to apply: email (pending)  │
  │ DM the author · 1d        │ │ Why it matched: checks…        │
  │ Platform eng. · Bar       │ │ The post: …                    │
  │ Rescued · 5d              │ │ Also on the job board ↗        │
  └───────────────────────────┘ └────────────────────────────────┘
```

### The four tabs

All four follow the profile picker ("All profiles" included) and the 24h / 7d window, with their counts on the tab, like today's Matches and Review _(proposal)_.

- **Matches.** The profile's `qualified` post roles with no decision on their linked group (slice 04's shared read), plus the user's rescued posts (below). Each row shows how to apply. Badges: **Email pending**, **Rescued**, **Unverified** (as for listings). The user acts by hand on all of them: Applied, Not for me, Expired, exactly as on the job board, which moves them to Applications.
- **Review.** The profile's `review` post roles, undecided. This is the brief's "review list for unsure posts": slice 04 already sends every role of an unsure-verdict post to `review` (rule `hiringVerdict`) _(proposal)_. The existing review choice (`match_reviews`: move to Matches or out) works here as for listings _(my call)_. **An approved post review is an ordinary qualified match** _(user, from the builder check)_: when its post verdict is sure and it states an email it is Email pending, and slice 05 may email it. A later re-decision for another reason ends the approval, as for listings. An unsure-verdict role is never emailed, approved or not (slice 05).
- **Disqualified.** The profile's `rejected` post roles, newest decision first, each with the checks that failed and their reasons (wrong seniority, `you blocked <name>`, `posted 34 days ago`, …). Every rejected role is listed, non-engineering ones included _(proposal)_. Social posts only: job-board listings get no such tab _(user)_. Action: **Rescue**; on a role rejected for a blocked author, **Unblock <name>** instead (the list stays the one source of truth) _(proposal)_.
- **Junk.** Post jobs (`kind = 'post'`, active) whose current post extraction's verdict is `not_hiring` or `junk` (sure or unsure), found by one of the profile's searches, newest first by when the post was first seen _(user: every user, to check nothing valuable was thrown out)_. Each shows the verdict, its confidence and reason, the post and the author. Action: **Rescue**.
  - "Found by the profile's searches": a sighting of the post's raw item (`raw_item_sightings.queryId`) whose query belongs to the profile (`profile_query_search_builders`), for any source of the post job (a share's and its original's) _(my call)_. A sighting with no `queryId` attributes to nobody.
  - A junk post has no role jobs (slice 03 writes roles only for hiring posts), so the Junk tab reads post jobs, not `job_matches`. It is a new read (an RPC like `match_details`, RLS-safe for the user) _(my call)_.

### Rescue _(user, approach B)_

A rescue means "this one is for me, I'll handle it". It is a hand-made match:

- **Only for the rescuer.** It changes nothing for other users: no re-extraction, no shared verdict change _(user)_.
- **Never re-decided.** The matcher never reads rescues, and no later rematch, re-extraction or archive takes a rescued post out of the rescuer's Matches _(user: the pipeline must not disqualify it again)_.
- **Never emailed.** Slice 05 skips any job with a rescue, whatever its outcome. The rescuer applies by hand from the post _(user)_ A Junk rescue has no role, no checked address and no facts for slice 05's rules, so it could not be sent safely anyway. A one-off "Email this" on a rescued post, approved by the user, is an open question for slice 05 _(user)_.
- **A Junk rescue covers its post's later roles** _(user, rescue wins)_. While it is live, the roles a later re-extraction makes of the post are hidden from the rescuer's tabs whatever their outcome and cannot be rescued again; the post stays in Matches as **Rescued**. **Undo rescue** brings the roles back to their tabs.
- **Junk and Disqualified alike** _(user)_. A Disqualified rescue is on the role job; a Junk rescue is on the post job (it has no roles). Either way the post shows in Matches with the **Rescued** badge, its post text, author and links. A Junk rescue shows no role facts, because none were extracted.
- **Files a report** _(user)_. The rescue row is the report: it records what the system said (the verdict, its confidence and reason, or the failed checks and the matcher version), the extraction it read, and an optional note from the user ("why this is for me"). The owner reads every user's rescues on a read-only `/admin/rescues` list, newest first _(my call)_, to fix Extract's prompt or the rules.
- **Per user, not per profile** _(my call)_: a rescued post shows in Matches under every profile that found it (Junk) or rejected it (Disqualified), and under "All profiles".
- **Blocking wins** _(my call, from the builder check)_: blocking the author (or a sharer) of a rescued post hides it from Matches while the block stands. The rescue and its report stay, and Unblock brings it back. The Junk tab also hides blocked authors' posts.
- **Undo.** The rescuer can take a rescue back while it has no decision; it returns to its tab. The report stays for the owner (the row is marked undone, not deleted) _(my call)_.
- **Decisions on a rescued post.** Applied, Not for me and Expired work as on any match and list it in Applications. `job_decisions`' insert policy today requires a `job_matches` row; it also accepts a job the user rescued _(my call)_.
- **Storage.** A new user-owned table (e.g. `post_rescues`): `id` (database default, users insert through PostgREST), `userId`, `jobId` (the role job or the post job), `origin` (`junk` | `disqualified`), the snapshot above, `note`, `undoneAt`, timestamps, one live rescue per `(userId, jobId)`. RLS: owners read their rows, insert only on a job that is in their Junk or Disqualified tab, and set `undoneAt` on their own. The engine reads them all _(my call)_.

### Email pending _(user)_

- A post role shows **Email pending** in Matches when it would be emailed: `qualified` for the profile, its post verdict sure, a contact email stated, not rescued, and no decision on its linked group. One SQL function answers this per job and user, so slice 05 extends the same definition (address and role already emailed, daily cap, blocked author at send time, Gmail connected) instead of copying it _(my call)_.
- The badge means the same before slice 05 ships, before Gmail is connected, and while a send is really queued afterwards _(user)_. Until slice 05, such posts simply stay pending; the user can still apply by hand or mark them Not for me, which takes them out of the pending set (slice 05 never emails a job with a decision).
- When a post names several roles, each qualified emailable role shows the badge; slice 05 sends one email per post per user and settles which role it names _(my call; slice 05's rule)_.

### Post details

The detail of a post role, in this order _(proposal)_:

- The role, company and badges, and **Posted N days ago** (the role job's `postedAt`, the original's date).
- **How to apply**, from the role's extraction: email (with Email pending), DM, comment or connect with the author, an external apply link, or a LinkedIn job-board link.
- **The author**, linked to their LinkedIn profile or company page, and for a share, the sharer too. Each has a **Block** action (below).
- **Why it matched / why it failed**: the same checks view as listings, the three post checks included.
- **The post**: the original's text, and for a share, the sharer's text above it, from the post job's sources.
- **Linked copies** (slice 04's linked group): "Also on the job board ↗" opens the listing on the job board; "Also posted by <author> ↗" opens the other post role. A decision on one already counts for both.

A rescued Junk post shows the author, the post, the verdict it was rescued from and the post's links, with no facts or checks.

### Blocked authors _(user)_

- **Preferences → You → Blocked authors**: the user's list for all their profiles, with each author's name (when known), link and the date blocked, and **Unblock**. The user adds one by pasting a LinkedIn link: `linkedin.com/in/<id>` gives `profile:<id>`, `linkedin.com/company/<name>` gives `company:<name>`, both lowercased and URL-decoded, the same key Prepare uses. Anything else is refused with a message _(my call on the accepted forms)_.
- **Block from a post** _(proposal)_: the Block action on the author or a sharer, after a confirm dialog, adds them with their name. The post's roles move to Disqualified ("you blocked <name>") once the sweep re-decides them; the UI says so instead of waiting.
- Slice 04 leftovers: `authorKey` is lowercased on insert (in the database, so every writer agrees), and `blocked_authors.id` gets a database default _(slice 04)_.

### Webhooks _(user)_

- A qualified post role sends `match.qualified` to the user's webhook like a listing, marked as a social post and carrying the author (and sharers), the post link and how to apply. The fields a post has no value for are null. The builder settles whether this stays payload version 1 with added fields or needs a version bump, and updates `docs/webhooks.md` _(my call that it is additive if receivers can ignore unknown fields)_.
- **Held while Email pending** _(user, approach A)_: an emailable post gets no match delivery while it is Email pending. Slice 05 creates the delivery when its send settles: applied by email, or apply by hand with the reason (failed, refused by a safeguard). So in this slice, emailable posts send no webhook at all, and every webhook a receiver gets is final.
- A post that leaves Email pending without a send in this slice (the user decided it by hand) sends no match webhook _(my call)_: the user already acted on it.
- **A rescue sends no webhook** _(my call, from the builder check)_: the user rescued it by hand in the app, and a rescue has no qualified match for the delivery table (`webhook_deliveries` is keyed by profile and job, and its loader reads `job_matches`). Receivers' Applied / Not for me callbacks therefore never see a rescued post.
- **The hold covers every way into `qualified`** _(my call, from the builder check)_: a post role approved from Review that is then Email pending gets no delivery either, like one the matcher qualified.
- **No backfill** _(my call, from the builder check)_: lifting the post filter would make the post-deploy rematch send every past qualified post role at once. Post deliveries are only created for post roles first decided qualified after this slice's deploy (a cutoff stored once at migration, read by `webhook_enqueue_match`).

### Slice 04's listing-only filters, lifted

Every place slice 04 kept listing-only reads post roles where this slice shows them: `match_details`' `p_kind` (the posts page passes `'post_role'`; the job board keeps `'job'`), the webhook enqueue, `pausedUsersCte`, and `db:analyze`. `decidedJobHref` sends a decision inherited through a linked group to where the decided copy lives _(slice 04)_. Applications lists post roles with a "Social post" marker, linking to the posts page _(my call)_.

## Approaches

**Who the Junk tab is for** _(user: every user)_. The brief had it as the owner's check. The owner chose a tab for every user, mostly to make sure nothing valuable was ruled junk.

**What a rescue does** _(user picked B)_.

- A. A private second reading: send the post back to Extract as hiring, write role jobs only the rescuer is matched with, then run the usual checks and email. Rejected: Extract and the matcher can still disqualify the rescued post, which defeats the rescue.
- **B. A hand-made match (chosen)**: the rescue goes straight into the rescuer's Matches, never re-decided, never emailed, applied to by hand, with a report. It costs nothing to run and leaks to no one. The cost is that a wrongly disqualified post with a good address is not emailed.
- A rescue that counts for everyone (fix the shared verdict) was rejected: one user's misjudgment would reach other users' Matches and emails.
- Disqualified rescues first followed the review override (`match_reviews` on a rejected match, re-decidable, emailable). The owner chose the same hand-made rescue as Junk, for the same reason.

**When a post webhook fires** _(user picked A)_.

- **A. Hold while Email pending (chosen)**: every webhook is final and agrees with the badge. Until Gmail is connected, emailable posts reach the user in the web app only.
- B. Two events (matched now, updated when the send settles): needs receivers to handle updates.
- C. "Can't send now" counts as an outcome: contradicts the badge, and a post could be emailed after a webhook said apply by hand.

## Constraints

- Contract changes only in `libs/database/src/contract/contract.prisma`, RLS included: the rescues table, the `blocked_authors` id default and lowercasing, the `job_decisions` insert policy, the new RPCs (Junk list, Email pending). Advance `app/refs/db.json` and regenerate `database.types.ts` (CI diffs it).
- The job board's page, counts and webhooks must not change for listings.
- No new engine rule and no `MATCHER_VERSION` bump: the matcher doesn't know about rescues.
- Ships after slice 04 is deployed, which itself waits on the credits and capacity fix. Slice 05 ships after this slice.

## Left to the builder

- Splitting into PRs (for example: tabs and details read-only; rescues and reports; blocked authors page and block from a post; webhooks and the lifted filters).
- The exact RPC shapes, indexes for the Junk read, and the admin rescues list's columns.

## Rollout check on dev

- With slice 04 deployed and rematched: the owner's Social posts tabs show the same counts as SQL over `job_matches` (qualified, review, rejected for post roles) and the Junk read; the job board's counts are unchanged.
- A post with a contact email shows Email pending; marking it Applied moves it to Applications and drops the badge.
- Rescue one Junk and one Disqualified post: each shows in Matches as Rescued, survives `db:rematch -- --all`, appears on `/admin/rescues`, and another user sees no change.
- Block an author from a post: their roles land in Disqualified with the reason after the sweep; Unblock brings them back.
- The test webhook receives a non-emailable post role marked as a social post, and nothing for an Email pending one.
- 360px: the switch, the four tabs and the post detail fit.

## Handed to later slices

- 05: extend the Email pending definition into the send queue; skip rescued jobs; create the held post webhooks when a send settles; one email per post per user and per linked group.
- Later: separate pages for other sources; acting on rescue reports (prompt and rule fixes).
