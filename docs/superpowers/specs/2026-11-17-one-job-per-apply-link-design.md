# One job per apply link

Date: 2026-11-17. Roadmap brief: `docs/roadmap/phase-3-find-quality/06-one-job-per-apply-link.md`.

## Intent

A user nearly applied twice to one BairesDev job because the list showed two copies of the ad as different jobs. The rule the user wants: **LinkedIn jobs that share an apply link are one job, whatever their titles.** A merged job says so on its page, and the user can see each posting behind it and where they differ.

Why it matters:

- Applying twice to one employer (the first anti-goal: applying to the wrong jobs, and spamming recruiters).
- Repeat jobs in front of the user, and processor spend on copies (the 9 Hired copies are processed and matched 9 times).

## What changes today's behaviour

The LinkedIn job key is `url:<canonical apply URL>|<exact title>` (`apps/xjobs/src/modules/ingest/normalize/job-key.ts`). The title was added on 2026-11-01 (normalizer version 2) in case some boards (Paylocity, UKG, SuccessFactors) use one listing URL for several roles. On dev no such case exists: every Paylocity and UltiPro link names a posting (`/Jobs/Details/4310338`, `opportunityId=<uuid>`), and the only `url:` keys that share a URL are the 4 groups in the brief (19 jobs, all with differing titles).

Already in place and reused as is:

- Every posting's normalized record (title, description, place, salary, links) is kept in `normalized_versions.record`, linked to its job through `normalized_job_sources`.
- When a key change empties a job, `linkJob` marks it `merged` with `mergedIntoId`, carries its processing state and extraction to a newly created job, and moves the user's decisions (`moveDecisions`: applied beats dismissed, else the newer one wins).
- The job's own fields come from one posting per field (`mergeSources`); `fieldSources.title` names the posting the title came from.
- The matcher deletes matches of jobs that are no longer `active`.

## Goals

1. Key a LinkedIn job with a usable apply URL by the canonical URL alone: `url:<canonical>`.
2. On a job's page, show a label when the job has more than one posting, and a collapsed list of its postings with what differs.
3. After rollout on dev, the 4 groups in the brief are 4 jobs.

## Non-goals

- **Same page, different link** (BairesDev `/job/111/282841/apply` and `/job/111/287470/apply`). The user calls it an edge and it is not handled. Merging by BairesDev group would also merge very different roles: group `111` holds 9 jobs from "Desarrollador Junior Node.js" to "Distinguished Engineer". Following redirects doesn't help either: BairesDev answers our requests with 403.
- **No title split per host.** No board on dev needs one. If one turns up, a per-host title split is a later change, and a wrong merge is visible in the postings list.
- **No label in the list.** Only the job page shows that a job is merged.
- **No full second description.** A posting whose description differs gets a mark and a link to it on LinkedIn.
- **Places stay those of the shown posting.** Matching keeps reading the places the processor extracted from one description. Matching on every posting's places is separate work; in the 4 dev groups the postings name the same place.
- **Review choices don't move on a real merge** (Claude's call). A `match_reviews` choice belongs to a match on one rule and field, and the target job is matched on its own. A job whose reviewed copy merged away can come back to review once. A job that is only re-keyed keeps its review choices (see 1b).
- **No reprocessing, at rollout or later** (user's decision). A merged job keeps the extraction it has, so its facts can come from a different copy than the page shows. Copies of one ad almost always carry the same text, and reprocessing would undo the savings.
- **Marked jobs are not exempt going forward** (agreed). A new copy of a job the user already marked joins that job and shows as already decided, which is the point of the slice.
- Ashby, Greenhouse and `linkedin-job:` keys are unchanged.

## Anti-goals

- Merging two different roles. The existing guard stays: the URL must contain an identifier-like token (4+ digits or a UUID), else the job keeps its `linkedin-job:` fallback key.
- Losing anything the user marked: applied, "not for me", viewed. A job whose key only changed keeps its id.
- Making the matches list slower. The postings are read only for the job being viewed.

## Approaches

The key change and the page were decided in the conversation. The open choice was how the page gets the postings:

- **A. A separate read, `job_postings(job_id)`, called by the job page (picked).** Smallest change; the list read (`match_details` with `p_details: false`, cut down earlier for speed) is untouched.
- B. Add the postings to `match_details`. One read instead of two, but it changes a large function used by the list, the job page and Applications, and adds weight to every row for a section most jobs lack.
- C. Store a "N postings, these differ" summary on the job at ingest. Cheap to read, but it stores something derivable, goes stale when postings move, and needs a schema change.

The user picked A.

## Design

### 1. Job key (engine)

In `jobKey`, the LinkedIn branch returns `url:${canonical}` when the canonical URL passes `identifierPattern`. The title is no longer part of the key, and a record without a title no longer falls back to `linkedin-job:`. `canonicalApplyUrl`, `atsKey`, `isStrongJobKey` and `effectiveKey` are unchanged. Bump `NORMALIZER_VERSION` to 6, with a comment saying the job key dropped the title and that `db:renormalize` is required.

Update `job-key.spec.ts`: two titles under one URL give one key, and the listing-page test that asserted different keys for different titles is reversed. Update the ingest spec's key paragraph (`docs/superpowers/specs/2026-11-01-ingest-normalized-jobs-design.md`, rule 2) to the new rule, with a dated revision note.

### 1b. Keep the user's marks through the re-key (engine)

The user's requirement: nothing they marked is lost. Today `linkJob` never renames a key: a new key with no job creates a new job, and the old one becomes `merged` into it. With the title dropped, that would give every `url:` job a new id (547 active on dev), deleting their matches, review choices and viewed marks.

**Rename in place.** In `linkJob`, when the item's new key has no job yet, and the item is linked to an old job of which every source now has the new key, update that old job's `jobKey` to the new key and keep linking to it. Each other source's key is worked out by the item's own rule (`jobKey`, then `effectiveKey`) from the record its link points at. The old job keeps its id, matches, extraction, processing state, decisions, review choices and viewed marks. It is not counted as created, so it isn't sent to Process. On dev on 2026-11-17, 476 of the 547 active `url:` jobs have one source and 71 have 2 to 22, all 71 with an extraction and matches; every one whose sources all keep one apply link takes this path. This applies to every re-key, not only the title drop: an easy-apply job that later gains an apply URL, or a LinkedIn job whose URL turns out to name an Ashby posting, also keeps its id. Today's "a re-key creates the job and carries the extraction over" path (`inherited`, `carriedExtraction`) can then no longer be reached, and is removed. When the new key already has a job, the old job is emptied and merged into it as today. When a source of the old job now has a different key, the item moves to a new job and the old job is re-merged as today.

**A real merge moves every mark.** When an old job is emptied and becomes `merged` into an existing job:

- Decisions move as today (`moveDecisions`).
- **Viewed marks move too** (new): each `job_views` row of the old job moves to the job it merged into. Where the user already viewed the target, theirs stays (builder's call on which timestamp to keep). `copyDecisionsBack` gets a matching copy-back for views when a merged job revives.
- Review choices (`match_reviews`) don't move. They belong to a match on a rule and field, and the target job is matched on its own. On dev there are none on `url:` jobs.

Tests in the ingest writer's spec: a sole-source re-key keeps the job id, its decision and its view; a two-copy group ends as one active job holding both users' decisions and views; a revived merged job gets its views back.

Regrouping on `db:renormalize` then works like this for each of the 4 dev groups: the first copy re-keys its own job in place, and each later copy empties its old job, which becomes `merged` into it with its decisions and views.

### 2. `job_postings(p_job_id uuid)` (database)

A new migration under `libs/database/src/migrations/app/`. Advance the hash in `refs/db.json`, or the migration silently never applies. The function is `LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''`, granted to `authenticated`, in the same style as `match_details`.

Access: it returns rows only when the caller (`(SELECT auth.uid())`) has a `job_matches` row or a `job_decisions` row on `p_job_id`. Otherwise it returns no rows, not an error. It reads the engine-only tables, which RLS keeps from the user directly.

One row per `normalized_job_sources` link of the job, from each link's `normalized_versions.record`:

| column               | meaning                                                                                                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rawItemId`          | the posting                                                                                                                                                |
| `channel`            | from `raw_items`                                                                                                                                           |
| `title`              | the posting's title                                                                                                                                        |
| `location`           | the posting's location text                                                                                                                                |
| `postedAt`           | the posting's `postedAt`                                                                                                                                   |
| `postingUrl`         | its LinkedIn link                                                                                                                                          |
| `shown`              | true for the posting named by the job's `fieldSources.title`                                                                                               |
| `titleDiffers`       | title differs from the job's title                                                                                                                         |
| `placeDiffers`       | location, country code or city differs from the job's                                                                                                      |
| `descriptionDiffers` | `descriptionText` differs from the job's, after collapsing whitespace and trimming (null on either side counts as differing only if the other is not null) |

Order: the shown posting first, then by `postedAt` ascending, nulls last.

A db test in `apps/db-tests/src/` (pattern of `match-details.db.spec.ts`) covers: a two-posting job returns both with the right flags; a single-posting job returns one row; a user without a match or decision on the job gets no rows; another user's job gets no rows.

### 3. Job page (web)

Where the job page loads the selected job (`apps/web/src/lib/matches/selected.ts` for Matches and Review; `apps/web/src/app/(app)/applications/page.tsx` for Applications), also call `job_postings` for that job, in parallel with `loadMatch`. A failed read hides the section and doesn't break the page.

In `apps/web/src/components/matches/match-detail.tsx`, when there are two or more postings:

```
Front-End Developer (Angular) - Remote Work            [Merged · 2 postings]
BairesDev · Colombia · Remote
──────────────────────────────────────────────────────
  ▸ 2 postings share this apply link                      (collapsed by default)

  expanded:
  ● Front-End Developer (Angular) - Remote Work           shown above
    Colombia · posted 3 Nov · View on LinkedIn ↗
  ○ Desarrollador Front-End (Angular) - Trabajo Remoto    title differs
    Colombia · posted 5 Nov · View on LinkedIn ↗          description differs
```

- `Badge` next to the title: "Merged · N postings".
- A collapsed section, "N postings share this apply link". Each line shows title, place, posted date and "View on LinkedIn" (opens `postingUrl` in a new tab), "shown above" on the shown posting, and "title differs", "place differs", "description differs" only where true.
- With one posting, nothing changes on the page.
- Built only from `components/ui` and theme tokens, per `apps/web/DESIGN.md`. Works at 360px.

## Rollout and checks on dev

After merge and deploy (the migration applies at deploy):

1. Before the run, read-only: count active `url:` jobs, how many of them have more than one source, how many of those have a `currentExtractionId`, and how many active `url:` jobs have `currentExtractionId IS NULL` (on 2026-11-17: 547 active, 71 with more than one source, all 71 with an extraction, 3 without an extraction; 0 active jobs anywhere with both a null processing status and a null `currentExtractionId`).
2. Run `pnpm --filter @xjobs/xjobs db:renormalize` against dev (`XJOBS_ALLOW_REMOTE_DB=1`).
3. Check:
   - No job lost its extraction: the count of active `url:` jobs with `currentExtractionId IS NULL` is not above the count before the run, and no active job has both a null processing status and a null `currentExtractionId` (a job the rebuild created instead of renaming).
   - The count of active `url:` jobs drops by exactly 15 from the count before the run.
   - The 4 groups in the brief are 4 active jobs; the other 15 are `merged` into them. Every other `url:` job kept its id (count of active `url:` jobs drops by exactly 15, and the 14 viewed marks and 13 decisions on `url:` jobs are all still on active jobs).
   - No other `url:` key grouped more than one distinct title, or if one did, the titles name the same role. Query: active jobs with a `url:` key and more than one source with different titles.
   - Decisions on the merged-away jobs are on the job they merged into.
   - The merged-away jobs have no matches, and the 4 merged jobs still have theirs.
4. Nothing is reprocessed (user's decision). The regrouping run sends nothing to Process and touches no marked job: on 2026-11-17 none of the 19 copies had a decision, a viewed mark or a qualified match.
5. Further checks:
   - The Angular pair's page shows the label and both titles, with "title differs".
   - Processor jobs-per-day drops over the next days, as new copies join existing jobs instead of being processed.

## Left to the builder

- Exact SQL of `job_postings`, including how the access check and the `fieldSources` lookup are written.
- How the web types for the new function are generated (`libs/database/src/supabase/database.types.ts`) and where the read helper lives (`apps/web/src/lib/matches/`).
- The section's exact wording, spacing and collapse control, within `DESIGN.md`.
- Whether the plan is one PR or a stack (engine key, migration, web). The renormalize runs only after all of it is on dev.
