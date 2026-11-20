# Non-remote jobs leaking into remote matches

Date: 2026-11-20
Status: approved 2026-11-20
Roadmap: [Phase 3 slice 09](../../roadmap/phase-3-find-quality/09-non-remote-leak.md)

## Problem

The owner's profile wants remote jobs abroad, and hybrid or onsite jobs only in Morocco. In the 7 days to 2026-11-20, 236 jobs qualified on `10xjobs-dev`. 50 of them were hybrid, onsite or had no stated arrangement, and none of those 50 was in Morocco. All but the 12 in group B passed on an **unknown** location, and unknown never rejects.

| Group                                              | Jobs | Examples                                                                                                                                                                        | Why it passes today                                                                                                                                                                                                                                                             |
| -------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Hybrid or onsite, place only mentioned          | 9    | AngelList `01a1f421-a131-729f-926a-ced9d6812be6`, Gusto, Obie, CentralReach, ForgeMission, ewo, depthfirst, Solve Intelligence, Mo Works `01a1f381-02d4-70db-870f-f65728f7c4e4` | A `mention` place turns a place failure into unknown (`matcher/rules/location.ts`, `checkArrangement`). Mo Works has no place at all: LinkedIn's Cairo was dropped because the description stated a time zone (`facts/rules/combine.ts`, `combineOpenings`, the `silent` test). |
| B. One opening offering remote or office           | 12   | Plan A ×2, Luxoft, COUNT, Exadel, Vantage, CreateFuture ×5, Sueep `01a1ef66-935b-71eb-b0ec-b56eb380befb`                                                                        | The remote option passes. Correct for most; the processor invented remote for Sueep ("Flexible / Hybrid (depending on candidate)") and CreateFuture ("flexibility over rigid rules").                                                                                           |
| C. Office opening plus a remote line with no place | 7    | Nourish ×2, Motional, Torentify `01a1e9d1-d044-74af-9dc3-f89b1691f53b`, Gusto ×2, Zebomba                                                                                       | The remote opening has no place, and LinkedIn's place isn't used because another opening has places.                                                                                                                                                                            |
| D. No arrangement anywhere                         | 22   | Meta NYC `01a1f3ec-24e8-764a-9e0c-90f11139ef6c`, JPMorgan NYC, Databricks London and Amsterdam, Cisco London                                                                    | No LinkedIn workplace tag, a silent description, and an unstated arrangement is checked as possibly remote, giving unknown.                                                                                                                                                     |

The same review found the reverse problem: the processor reads an arrangement into lines that only give a place, a residence rule or a work permit. Of 196 jobs LinkedIn tags remote that the description reading calls hybrid or onsite, 52 have no arrangement words. About 18 of those have real office evidence ("must reside within a reasonable commuting distance of…"). About 34 do not ("Must reside in the UK", "This position is based in Herndon, Virginia", "authorized to work in the United States"). Those 34 are rejected on arrangement when they should be judged on location and authorization.

## Intent

The product is built for every user, not only the owner. A remote job is remote whoever reads it. Whether it fits a given user is decided by that user's places, residence and work authorizations, not by bending the arrangement.

## The rule _(user)_

1. **Arrangement:** the description's, when it states one, by explicit words or obvious office evidence. Otherwise the source channel's tag (LinkedIn today; Indeed or others later). Otherwise none.
2. **Job location** (a description `label`, or the source's place) is checked against the places the user is open to, per arrangement.
3. **Location requirement** (a description `limit`) is checked against where the user lives (the residence check).
4. **Authorization requirements** are checked against the user's work authorizations (unchanged).

## Goals

- None of the 50 leaks above qualifies unless a source states remote and the place fits.
- A remote job that binds the person to a place is rejected by residence or authorization, with that as the recorded reason, not by arrangement.
- Every new rejection records a reason that names its cause.

## Non-goals

- Dropping jobs LinkedIn doesn't tag remote at collection. Decided earlier _(user)_: the processor judges them.
- Why LinkedIn returns untagged rows from remote searches (the AI-search lead). Moved to [slice 10](../../roadmap/phase-3-find-quality/10-search-yield.md) as a cost question _(user)_.
- Reading the arrangement from the job's ATS posting (Greenhouse, Ashby) when LinkedIn and the description are both silent. A follow-up for the roadmap _(user)_.
- City-level residence. "Remote, candidates must live in Charlotte, NC" passes any US resident; the residence check stays at country level.
- Conditional remote ("many eligible to be completely remote"). Those jobs already go to review.

## Anti-goals

- Rejecting a remote job because its posting gives a location, when the user is open to that location and the posting doesn't bind the person to it.
- Qualifying a job no source calls remote, for a user who accepts only remote there.
- Growing review. It is already 208 against 236 qualified a week; nothing here sends new jobs to review _(user)_.

## Approaches

- **Staged PRs, tightening first, loosening last (chosen, _user_).** Matcher leak fixes ship first: they only reject, cost no Claude credit, and remove about 31 of the 50 leaks on a rematch. The facts fill follows. Then the prompt changes and their reprocess. The `limit`-only residence check ships last, only once the reprocess is done, because relaxing residence before the processor re-reads `label` and `limit` would let misread lines ("opportunity for PL based candidates", read today as `label`) stop binding. Each step is measured on dev before the next. The user chose three PRs; splitting the last one in two, so the reprocess window can't leak, is Claude's call.
- **One PR, one rollout (rejected).** Less overhead, but no way to tell which change moved which job, and nothing improves until the reprocess finishes.

## Design

### PR 1: matcher leak fixes (A, D)

In `apps/xjobs/src/modules/matcher/rules/location.ts`:

**A. A mentioned place binds hybrid and onsite openings.** In `checkArrangement`, when nothing overlaps, `mention` gives `unknown` only for `remote`. For `hybrid` and `onsite`, a mentioned office is where the person would go, so no overlap is `fail` like `label` and `limit`. A `maybe` overlap stays `unknown` for every arrangement.

- AngelList (hybrid, mentioned San Francisco; profile hybrid Morocco only): fail.
- A hybrid job mentioning "offices in Casablanca and Paris": pass.
- "Remote; offices in London and Berlin" for a profile without London or Berlin: unknown, as today.

**D. No arrangement anywhere is office-based.** An opening whose arrangements are only `unstated` after the facts combine (no description arrangement, no source tag) is checked as office-based: against the profile's `onsite` and `hybrid` places (the better of the two), never `remote`. A profile with neither gets `fail`. _(Including hybrid is Claude's call: a user who accepts only hybrid in Morocco should still get an untagged, silent Casablanca job.)_ The current `onlyUnstated && best === 'pass' ? 'unknown'` downgrade no longer applies to it.

- Meta NYC (unstated, LinkedIn place New York; profile onsite Morocco): fail.
- An untagged, silent job in Casablanca: pass on onsite _(user)_.
- An unstated opening with no place: unknown for a profile with onsite or hybrid places (nothing to compare), fail for a remote-only profile (no source says remote, and the user accepts nothing else). _(Claude's call, from the user's rule.)_

The reason text names the cause. For D: `no source states the arrangement; checked as onsite: job location (New York) does not fit your onsite places (MA)`. The exact wording is the builder's call; the cause must be readable in `checks`.

`fitsUnstated` in `checkOpening` (whether a ruled-out arrangement might be what fails) keeps working on the opening as if unstated. The builder must make sure it still means "could fit if the arrangement were unknown", not "checked as onsite". See "Left to the builder".

**No new reviews.** A failure from A (a mentioned place on a hybrid or onsite opening) or from D (an unstated opening checked as office-based) is a sure failure, even when the opening's `confidence` is `unsure`. It never goes to review _(user)_. On dev, 58 jobs have a hybrid or onsite opening whose only places are mentioned and unsure. `fitsUnstated` keeps meaning "could fit if the arrangement were unknown" for openings that state an arrangement.

Rollout: bump `MATCHER_VERSION` (9 → 10), deploy, `db:rematch -- --all`. Measure: the 50 jobs listed by the query in "Measuring", `db:match-shares`.

### PR 2: the source's place fills every opening without one (A's Mo Works, C)

In `apps/xjobs/src/modules/facts/rules/combine.ts`, `combineOpenings`:

Today the listing's place is used only when every description opening has no place **and no time zone** (`silent`). New rule: **each opening with no place takes the listing's place**, with `placeStrictness: 'label'` and `placesSource: 'linkedin'`, whatever the other openings hold and whether or not the opening has time zones. The opening's arrangement and time zones stay. Its quote gains `LinkedIn: <location>` as today.

The listing opening built when the description is fully silent (no places, no time zones, no stated arrangement) is unchanged.

- Mo Works: onsite, time zone UTC+8 to +11, no description place, LinkedIn Cairo → onsite in Cairo → fails the onsite check (Morocco).
- Nourish: hybrid NYC opening plus "This role also welcomes remote candidacy" with no place, LinkedIn New York → remote in New York → passes a profile open to US remote, as a real pass.
- Zebomba: the remote option already has a mentioned place (Petrozavodsk), so nothing fills it; it stays unknown.

A LinkedIn place is never a requirement (listing-facts spec, _user_): `placesSource: 'linkedin'` never triggers the residence check. Unchanged.

`placesConflict` compares description places with the listing place; an opening filled from the listing has no description place, so it adds no conflict. The builder checks that.

Reach on dev: 134 jobs with no description place, a time zone and a LinkedIn location (9 qualified), plus 21 jobs with a placeless opening beside placed ones (5 qualified).

Rollout: bump `FACTS_VERSION` (5 → 6). The match sweep rebuilds stale facts (`STALE_FACTS` in `matcher/repositories/matcher.repository.ts`) and re-decides them; no reprocess. Measure: Mo Works, the C jobs, and how the 14 previously qualified jobs moved.

### PR 3: the processor reads arrangement and strictness strictly

The prompt alone loosens nothing: a place-only line that becomes `unstated` takes LinkedIn's remote, and its `label` or `limit` place still binds through the residence check until PR 4. For the owner, the ~34 place-only jobs stay rejected, now by residence or authorization.

**Prompt** (`apps/xjobs/src/modules/processor/prompts/system.prompt.ts`, arrangements and placeStrictness sections):

1. **What states an arrangement.** Explicit words (remote, hybrid, onsite, office days, home office, telework, in any language), or obvious office evidence: commuting distance to an office or hub, relocation to an office or hub, "work out of this location", work at customer sites, physical or hands-on work, a share of office or mobile days ("40% mobilem Arbeiten"). A place, a residence rule, a work-permit or citizenship rule, or "flexible" / "flexibility" on its own states no arrangement: the opening's arrangements are `["unstated"]` and its place is still recorded.
2. **Who limiting words are about.** `limit` only when the words bind where the person hired lives or is based: "candidates must be based in", "you must reside in", "open to PL based candidates", "residents of". Words about the job or the team make a `label`: "the position is based in Herndon", "join our Vancouver based team", "Location: Brazil", "Remote (US)".
3. **Authorization is not location.** "Authorized to work in X", citizenship and clearance lines add an authorization requirement only. They don't make a `limit`: the work-authorization check already compares them with the user's permits and citizenship, and a `limit` would also fail a user who holds a US permit but lives elsewhere. _(From the user's rule 4.)_

Examples to add, each with its reading:

- "Location: Flexible / Hybrid (depending on candidate)" → `["hybrid"]`, not remote.
- "flexibility over rigid rules" with office hubs listed → `["unstated"]`, hubs as `mention`.
- "Candidates must reside within a reasonable commuting distance of one of our IT hubs" → `["hybrid"]` or `["onsite"]` per the rest of the posting, hubs as `limit`.
- "This position is based in Herndon, Virginia" → `["unstated"]`, Herndon `label`.
- "Must reside in the UK." → `["unstated"]`, GB `limit`.
- "Only able to consider candidates who are authorized to work in the United States" → `["unstated"]`, a US work-permit requirement, and no place from this line.
- "opportunity for PL based candidates" → PL `limit`.

**Golden set** (`apps/xjobs/src/modules/processor/golden/cases`): add cases for Sueep, a CreateFuture posting, the commuting-distance hub line, Herndon, "Must reside in the UK", the US work-authorization line, "PL based candidates", Solvex, and Cognizant's "Oficinas pet-friendly en el centro de Barcelona y Madrid" (let the new rule decide: office evidence or a mention). **The owner reviews these labels before PR 3 merges**; unreviewed labels fail the golden bars, so the plan has an explicit stop for that review.

Rollout: bump the prompt or extraction version the processor uses to mark jobs for reprocessing; run `processor:eval`; deploy; `db:reprocess` for the affected jobs (at least: jobs with an arrangement conflict, jobs with a `label` or `limit` description place, and the 50 leak jobs). New extractions are re-decided by the sweep as they land. Measure: how many of the ~34 place-only jobs become remote and why they're rejected (residence, authorization, or still qualified); review share.

### PR 4: residence binds only on `limit`

Opens once PR 3's reprocess has finished on dev.

**Matcher** (`apps/xjobs/src/modules/matcher/rules/residence.ts`, `residenceApplies`): the residence check applies only to description places with `placeStrictness: 'limit'`. A `label` is the job's location and is checked only against the user's open-to places _(user)_. This reverses the residence spec's call that `label` is strict (2026-11-17, Solvex "100% Remote opportunity (All over UK)", which will qualify again for a Morocco resident who lists UK). Update that spec's line with a pointer here.

On dev today, 773 jobs fail the residence check on a `label`; for 56 of them it is the only failing rule. Sample: "Location: Remote Europe", "Remote from Romania", "Fully remote (US)", "Job Location – Remote (USA & Canada)", "Location: UK". The owner accepts that some of these employers hire only residents without saying so _(user)_.

Rollout: bump `MATCHER_VERSION` (10 → 11), deploy, `db:rematch -- --all`. Measure: how many of the 56 label-only residence failures qualify (after PR 3's re-reading), and review share.

### Measuring

Each PR's body carries the SQL used on `10xjobs-dev` and the before and after counts. The groups above come from `job_matches.checks` (the `location` check's `detail`) joined with `job_facts.facts->'openings'` and `normalized_jobs.location` / `workplaceType`; the conflict counts from `job_fact_conflicts` where `field = 'arrangement'` on the job's current extraction. The builder may fold these queries into `db:analyze` if that is cheaper than keeping them in PR bodies.

## Left to the builder

- Exact reason wording, as long as D's cause and A's "mentioned place counts for hybrid/onsite" are readable from `checks`.
- How `fitsUnstated` and `openingUnsure` are changed to meet the rule in "No new reviews" below.
- Which prompt or schema version to bump for PR 3, and the reprocess flags that cover the affected jobs at the lowest Claude cost.
- Whether `contains`/`overlaps` in `combine.ts` need anything for the per-opening fill (they shouldn't).
