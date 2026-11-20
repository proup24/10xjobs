# Non-remote leak Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop hybrid, onsite and arrangement-less jobs from qualifying for remote-only places, and judge place-bound remote jobs by residence and authorization instead of arrangement.

**Architecture:** Four PRs to `main`, each branched from `main` after the previous one merged and was measured on `10xjobs-dev` (no stacking). PR 1 tightens the matcher's location rule, PR 2 fills missing places from the listing in the facts combine, PR 3 changes the processor prompt and reprocesses, PR 4 limits the residence check to `limit` places.

**Tech Stack:** TypeScript (strict, nodenext), NestJS engine in `apps/xjobs`, Vitest, Postgres on Supabase (`10xjobs-dev`), `claude -p` for the processor.

**Spec:** `docs/superpowers/specs/2026-11-20-non-remote-leak-design.md`

## Global Constraints

- Branch per PR from up-to-date `main`, in a worktree (the main checkout is shared). Push only with `git push -u origin <branch>`; open the PR with `gh pr create`; the human merges.
- Never stack PRs: PR n+1 starts only after PR n is merged and its rollout measured.
- Version bumps: `MATCHER_VERSION` 9 → 10 (PR 1) and 10 → 11 (PR 4) in `apps/xjobs/src/modules/matcher/config/matcher.config.ts`; `FACTS_VERSION` 5 → 6 (PR 2) in `apps/xjobs/src/modules/facts/config/facts.config.ts`. PR 3 needs no version bump: the extraction key includes `promptHash()`, which changes with the prompt.
- Nothing in this slice sends a job to review. A failure from a mentioned hybrid/onsite place (A) or from an arrangement-less opening (D) is sure, whatever the opening's `confidence`.
- A LinkedIn place (`placesSource: 'linkedin'`) never triggers the residence check.
- Each PR body carries the measurement SQL (Appendix) and before/after counts from `10xjobs-dev` (read-only `supabase-dev` MCP).
- CI must be green: `npx nx run-many -t lint test build typecheck`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; PR bodies end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

## Review Focus

- An opening with arrangements `['remote', 'unstated']` (stated plus unstated) keeps today's expansion to every arrangement; only an opening that is **only** `unstated` is office-based. Test in Task 2.
- An arrangement-less opening whose place the index can't place (`maybe` overlap) stays `unknown`, not `fail`. Test in Task 2.
- `fitsUnstated` must not recurse forever now that an unstated opening rules out remote. An unsure description arrangement over a LinkedIn place that fails must still return, and stay unsure when remote might fit. The existing `unsure` test for that case guards it (Task 2).
- An opening with time zones but no place, when the listing has no place, stays placeless (no crash, no conflict). Test in Task 3.
- A remote opening with `limit` places and a remote opening with `label` places for the same Morocco resident: after PR 4 only the `limit` one fails on residence. Test in Task 6.

---

## PR 0: spec and plan (branch `docs/slice-09-non-remote`, already holds the spec)

### Task 0: Publish the spec and plan

**Files:**

- Modify: `docs/roadmap/phase-3-find-quality/README.md` (row 09 status)
- Add: this plan

- [ ] **Step 1:** Set row 09's status to `Designed; plan written` and commit the plan with it.
- [ ] **Step 2:** `git push -u origin docs/slice-09-non-remote`, then `gh pr create --base main` titled `docs: slice 09 non-remote leak spec and plan`.

---

## PR 1: matcher leak fixes (branch `feat/non-remote-matcher`)

### Task 1: A mentioned place binds hybrid and onsite openings

**Files:**

- Modify: `apps/xjobs/src/modules/matcher/rules/location.ts` (`checkArrangement`, `FailedOn`, `openingUnsure`)
- Test: `apps/xjobs/src/modules/matcher/rules/location.spec.ts`

**Interfaces:**

- Produces: `type FailedOn = 'places' | 'mention' | 'residence' | 'timezones' | null`. `'mention'` means a mentioned place bound a hybrid/onsite opening and failed; `openingUnsure` never counts it as unsure.

- [ ] **Step 1: Write the failing tests.** Replace `fails an unwanted city when limited, unknown when merely mentioned` with:

```ts
it('a mentioned place binds hybrid and onsite, not remote', () => {
  const o = (arrangements: Opening['arrangements']) => opening({ arrangements, places: [berlin], placeStrictness: 'mention' });
  const p = exampleProfile();
  p.locations.remote = [{ kind: 'country', code: 'MA' }];
  expect(outcome([o(['onsite'])], p)).toBe('fail');
  expect(outcome([o(['hybrid'])], p)).toBe('fail');
  expect(outcome([o(['remote'])], p)).toBe('unknown');
});
it('a mentioned office that fits passes', () => {
  expect(
    outcome([
      opening({
        arrangements: ['hybrid'],
        places: [berlin, { kind: 'city', name: 'A', countryCode: 'MA', cityId: CITY_A }],
        placeStrictness: 'mention',
      }),
    ]),
  ).toBe('pass');
});
```

In `describe('unsure')` add:

```ts
it('a mentioned hybrid place that fails is sure, even on an unsure opening', () => {
  expect(
    check([
      opening({
        arrangements: ['hybrid'],
        places: [berlin],
        placeStrictness: 'mention',
        confidence: 'unsure',
      }),
    ]),
  ).toMatchObject({ outcome: 'fail', unsure: false, unsureField: null });
});
```

- [ ] **Step 2:** Run `npx nx test xjobs -- location.spec`. Expected: the mention test and the unsure test FAIL (`unknown` instead of `fail`); "a mentioned office that fits passes" already passes and guards against over-tightening.
- [ ] **Step 3:** In `checkArrangement`, no overlap with `placeStrictness === 'mention'` gives `unknown` only when `arrangement === 'remote'`; otherwise `fail` with `failedOn: 'mention'`. `maybe` stays `unknown` for every arrangement. In `openingUnsure`, `'mention'` is not in the unsure set.
- [ ] **Step 4:** Run `npx nx test xjobs -- location.spec`. Expected: PASS.
- [ ] **Step 5:** Commit `fix(matcher): a mentioned place binds hybrid and onsite openings`.

### Task 2: An opening with no arrangement is checked as office-based

**Files:**

- Modify: `apps/xjobs/src/modules/matcher/rules/location.ts` (`checkOpening`, `checkLocation` reason), `apps/xjobs/src/modules/matcher/config/matcher.config.ts` (`MATCHER_VERSION = 10`)
- Test: `apps/xjobs/src/modules/matcher/rules/location.spec.ts`

**Interfaces:**

- Consumes: `FailedOn` from Task 1.
- Produces: `checkOpening(opening, profile, idx, homes, unstatedAs: 'office' | 'any' = 'office')`. `'office'` expands an only-`unstated` opening to `['onsite', 'hybrid']`; `'any'` keeps today's expansion to every arrangement and is what `fitsUnstated` passes.

- [ ] **Step 1: Write the failing tests.** Replace `caps a match on only unstated arrangements to unknown` with:

```ts
it('an opening with no arrangement passes on an office place that fits', () => {
  expect(
    outcome([
      opening({
        arrangements: ['unstated'],
        places: [{ kind: 'city', name: 'A', countryCode: 'MA', cityId: CITY_A }],
        placeStrictness: 'label',
        placesSource: 'linkedin',
      }),
    ]),
  ).toBe('pass');
});
it('an opening with no arrangement fails surely outside the office places, with its cause', () => {
  const c = checkLocation(
    [
      opening({
        arrangements: ['unstated'],
        places: [berlin],
        placeStrictness: 'label',
        placesSource: 'linkedin',
        confidence: 'unsure',
      }),
    ],
    profile,
    idx,
  );
  expect(c).toMatchObject({ outcome: 'fail', unsure: false });
  expect(c.reason).toBe('no source states the arrangement, so it is checked as office-based: job location (unstated in Berlin) does not fit your wanted arrangements (remote, hybrid, onsite)');
});
it('an opening with no arrangement and no place is unknown with office places, fail without', () => {
  const remoteOnly = exampleProfile();
  remoteOnly.locations.hybrid = [];
  remoteOnly.locations.onsite = [];
  const bare = opening({ arrangements: ['unstated'] });
  expect(outcome([bare])).toBe('unknown');
  expect(outcome([bare], remoteOnly)).toBe('fail');
});
it('stated plus unstated keeps every arrangement', () => {
  expect(
    outcome([
      opening({
        arrangements: ['remote', 'unstated'],
        places: [berlin],
        placeStrictness: 'label',
      }),
    ]),
  ).toBe('pass');
});
it('an opening with no arrangement and an unplaceable city is unknown', () => {
  expect(
    outcome([
      opening({
        arrangements: ['unstated'],
        places: [{ kind: 'city', name: 'Nowhere', countryCode: null, cityId: null }],
        placeStrictness: 'label',
      }),
    ]),
  ).toBe('unknown');
});
```

The existing test `a LinkedIn place failing under an unsure description arrangement is unsure when another arrangement is wanted` guards the `fitsUnstated` path: it must still pass unchanged.

In `describe('residence') › describe('unstated arrangements')`: `are unknown when an on-site place fits` becomes `pass when an on-site place fits` with `toBe('pass')`; `fail surely for a remote-only profile` stays.

- [ ] **Step 2:** Run `npx nx test xjobs -- location.spec`. Expected: the new and renamed tests FAIL; the "unplaceable city" test may already pass (keep it).
- [ ] **Step 3:** In `checkOpening`, an opening whose arrangements are only `unstated` expands to `['onsite', 'hybrid']` when `unstatedAs === 'office'`; its `outcome` is `best` with no `onlyUnstated` downgrade; its `unsure` is `false` (never calls `fitsUnstated`). `fitsUnstated` calls `checkOpening(..., 'any')`, which keeps the old expansion and the old downgrade. An opening mixing `unstated` with stated values keeps today's expansion. In `checkLocation`, when the outcome is `fail` and every opening is only `unstated`, prefix the reason with `no source states the arrangement, so it is checked as office-based: `.
- [ ] **Step 4:** Set `MATCHER_VERSION = 10`.
- [ ] **Step 5:** Run `npx nx test xjobs`. Expected: PASS. Fix any other spec that pinned the old unstated behaviour (search `decide.spec.ts` and `matcher.*.spec.ts` for `'unstated'`), changing only the expected values the spec changes.
- [ ] **Step 6:** Commit `fix(matcher): an opening with no arrangement is checked as office-based`.

### PR 1 rollout (after CI green)

- [ ] **Step 1:** On dev, run Appendix query Q1 (the 50 leaks) and Q2 (outcome counts, 7 days); record them.
- [ ] **Step 2:** Push, `gh pr create`, with the before numbers and the steps below. Stop for the human merge and deploy.
- [ ] **Step 3:** After deploy: `XJOBS_ALLOW_REMOTE_DB=1 pnpm --filter @xjobs/xjobs db:rematch -- --all` (the human runs it if Claude has no remote credentials). Rerun Q1 and Q2 and `db:match-shares -- --days 7`; post the after numbers as a PR comment. Expected: A's 8 mention jobs and D's 22 no longer qualify; review share not higher.

---

## PR 2: the listing place fills every opening without one (branch `feat/listing-place-fill`)

### Task 3: Per-opening listing place

**Files:**

- Modify: `apps/xjobs/src/modules/facts/rules/combine.ts` (`combineOpenings`), `apps/xjobs/src/modules/facts/config/facts.config.ts` (`FACTS_VERSION = 6`)
- Test: `apps/xjobs/src/modules/facts/rules/combine.spec.ts`

**Interfaces:**

- Produces: unchanged signature `combineFacts(args)`. Each description opening with `places.length === 0` gets `places: [listing.place]`, `placeStrictness: 'label'`, `placesSource: 'linkedin'`, quote `[o.quote, listingQuote(listing.locationText)].filter(Boolean).join(' | ')`; arrangement, confidence and time zones stay. The fully-silent branch (no places, no time zones, no stated arrangement → one listing opening) is unchanged.

- [ ] **Step 1: Write the failing tests.** Replace `the listing place is skipped when the description has a time zone, but the arrangement is filled` with:

```ts
it('the listing place fills an opening that has only a time zone (Mo Works)', () => {
  const tz = { fromUtc: 8, toUtc: 11, label: 'Australia' };
  const { facts, conflicts } = combine(
    doc({ arrangementValue: 'unstated', openings: [opening({ timezones: [tz] })] }),
    listing({
      arrangement: 'onsite',
      place: { kind: 'country', code: 'EG' },
      locationText: 'Cairo, Egypt',
    }),
  );
  expect(facts.openings).toEqual([
    {
      arrangements: ['onsite'],
      places: [{ kind: 'country', code: 'EG' }],
      placeStrictness: 'label',
      timezones: [tz],
      quote: 'LinkedIn: Cairo, Egypt',
      confidence: 'sure',
      arrangementSource: 'linkedin',
      placesSource: 'linkedin',
    },
  ]);
  expect(conflicts.filter((c) => c.field === 'places')).toEqual([]);
});
it('the listing place fills a placeless opening beside a placed one (Nourish)', () => {
  const { facts } = combine(
    doc({
      arrangementValue: 'hybrid',
      openings: [opening({ arrangements: ['hybrid'], places: [paris], placeStrictness: 'label', quote: 'hybrid out of Paris' }), opening({ arrangements: ['remote'], quote: 'also welcomes remote candidacy' })],
    }),
    listing({ arrangement: 'remote', place: { kind: 'country', code: 'US' }, locationText: 'New York, NY' }),
  );
  expect(facts.openings).toMatchObject([
    { arrangements: ['hybrid'], places: [{ name: 'Paris' }], placesSource: 'description' },
    {
      arrangements: ['remote'],
      places: [{ kind: 'country', code: 'US' }],
      placeStrictness: 'label',
      placesSource: 'linkedin',
      quote: 'also welcomes remote candidacy | LinkedIn: New York, NY',
    },
  ]);
});
it('a time-zone-only opening stays placeless when the listing has no place', () => {
  const tz = { fromUtc: 0, toUtc: 2, label: 'European time zones' };
  const { facts, conflicts } = combine(doc({ arrangementValue: 'remote', openings: [opening({ arrangements: ['remote'], timezones: [tz] })] }), listing({ arrangement: 'remote' }));
  expect(facts.openings).toMatchObject([{ places: [], placeStrictness: 'unstated', placesSource: 'description' }]);
  expect(conflicts.filter((c) => c.field === 'places')).toEqual([]);
});
```

- [ ] **Step 2:** Run `npx nx test xjobs -- combine.spec`. Expected: the first two FAIL (places empty).
- [ ] **Step 3:** In `combineOpenings`, replace the `silent && place !== null` condition of `placed` with `place !== null`, mapping only openings with no places. Keep the listing-opening branch as is.
- [ ] **Step 4:** Set `FACTS_VERSION = 6`.
- [ ] **Step 5:** Run `npx nx test xjobs`. Expected: PASS (adjust only tests that pinned the old skip).
- [ ] **Step 6:** Commit `fix(facts): the listing place fills every opening without one`.

### PR 2 rollout

- [ ] **Step 1:** On dev, run Q1, Q2 and Q3 (jobs the fill reaches); record them.
- [ ] **Step 2:** Push, `gh pr create` with the numbers. Stop for merge and deploy.
- [ ] **Step 3:** After deploy the match sweep rebuilds stale facts (`STALE_FACTS`) and re-decides them; no command needed. When the sweep has caught up (Q3's jobs all have `factsVersion = 6`), rerun Q1–Q3; post the after numbers. Expected: Mo Works rejected; Nourish ×2, Motional, Torentify, Gusto Core Products qualify with location `pass`, not `unknown`.

---

## PR 3: the processor reads arrangement and strictness strictly (branch `feat/arrangement-evidence-prompt`)

### Task 4: Prompt rules

**Files:**

- Modify: `apps/xjobs/src/modules/processor/prompts/system.prompt.ts` (sections `### arrangements`, `### placeStrictness`, `### Writing openings`)
- Test: `apps/xjobs/src/modules/processor/prompts/prompt.spec.ts`

- [ ] **Step 1: Write the failing test** in `describe('systemPrompt')`:

```ts
it('states what counts as an arrangement and who limiting words bind', () => {
  expect(text).toContain('"flexibility" on its own');
  expect(text).toContain('commuting distance');
  expect(text).toContain('"the position is based in Herndon"');
  expect(text).toContain('"open to PL based candidates"');
  expect(text).toContain('An authorization line is not a place');
});
```

- [ ] **Step 2:** Run `npx nx test xjobs -- prompt.spec`. Expected: FAIL.
- [ ] **Step 3:** Write the three rules and seven examples from the spec's "PR 3" section into the prompt, in the spec's words (rule 1 under `### arrangements`, rules 2–3 under `### placeStrictness`, examples under `### Writing openings`). Remove `"based in"` from the generic `limit` word list and replace it with the person-bound phrasings. The prompt must contain the exact phrases the new test pins. Keep it free of the word "listing" and of personal content (existing tests).
- [ ] **Step 4:** Run `npx nx test xjobs -- prompt.spec`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(processor): arrangement needs words or office evidence; limits bind the person`.

### Task 5: Golden cases

**Files:**

- Create: nine files in `apps/xjobs/src/modules/processor/golden/cases/`, named by the dev job id: Sueep `01a1ef66-935b-71eb-b0ec-b56eb380befb`, CreateFuture `01a1e963-0761-76d9-b008-71711697731b`, a commuting-distance IT-hub job, a "This position is based in Herndon, Virginia" job, a "Must reside in the UK." job, an "only able to consider candidates who are authorized to work in the United States" job, the "opportunity for PL based candidates" Luxoft job, Solvex `01a1e54f-03ac-741f-9509-d23497358c7e`, and the Cognizant "Oficinas pet-friendly en el centro de Barcelona y Madrid" job. Find the unnamed ids with Q4.

- [ ] **Step 1:** For each job, write `{ id, input: { title, description }, expected, drafted }` in the shape of `cases/1078.json`. `input` is `normalized_jobs.title` and `descriptionText` from dev. `expected.openings` is the spec's reading for that line; the other `expected` fields copy the job's current extraction. Set every `drafted` value to `reviewed: false`.
- [ ] **Step 2:** Run `npx nx test xjobs -- golden.spec`. Expected: PASS (the cases load).
- [ ] **Step 3: Stop.** Ask the owner to review the nine `expected.openings` and set `reviewed: true` where the case uses `drafted`. Apply their corrections.
- [ ] **Step 4:** Owner runs `pnpm --filter @xjobs/xjobs processor:eval` (uses `claude -p`); paste the summary into the PR. Expected: the golden bars hold and the nine new cases match.
- [ ] **Step 5:** Commit `test(processor): golden cases for arrangement evidence and limits`.

### PR 3 rollout

- [ ] **Step 1:** On dev, run Q1, Q2, Q5 (arrangement conflicts without arrangement words); record them.
- [ ] **Step 2:** Push, `gh pr create` with the numbers and the eval summary. Stop for merge and deploy.
- [ ] **Step 3:** After deploy, reprocess the affected jobs only. Q6 lists their ids: jobs with an arrangement conflict, jobs with a `label` or `limit` description place on a remote search, and the 50 leak jobs. Save the ids to a scratch file, then run `xargs -a ids.txt -n 50 sh -c 'XJOBS_ALLOW_REMOTE_DB=1 pnpm --filter @xjobs/xjobs db:reprocess -- $(printf -- "--job %s " "$@")' _`, in batches the daily processor budget allows.
- [ ] **Step 4:** When Q6's jobs all have a new extraction, rerun Q1, Q2, Q5; post the after numbers. Expected: most of the ~34 place-only jobs are now `unstated` + LinkedIn remote and rejected for the owner on residence or work authorization; Sueep rejected; CreateFuture still qualified via LinkedIn's tag.

---

## PR 4: residence binds only on `limit` (branch `feat/residence-limit-only`)

Start only after PR 3's reprocess finished.

### Task 6: `residenceApplies` limit only

**Files:**

- Modify: `apps/xjobs/src/modules/matcher/rules/residence.ts` (`residenceApplies`), `apps/xjobs/src/modules/matcher/config/matcher.config.ts` (`MATCHER_VERSION = 11`), `docs/superpowers/specs/2026-11-17-residence-location-design.md` (line "Treating `label` as strict is the user's call." gets "Reversed 2026-11-20: only `limit` binds, see 2026-11-20-non-remote-leak-design.md."), `docs/roadmap/phase-3-find-quality/README.md` (row 09 `Done (PRs …)`)
- Test: `apps/xjobs/src/modules/matcher/rules/residence.spec.ts`, `apps/xjobs/src/modules/matcher/rules/location.spec.ts`

- [ ] **Step 1: Write the failing tests.**
  - `residence.spec.ts`: `applies to description label and limit` becomes `applies to description limit only`, expecting `true` for `limit` and `false` for `label`.
  - `location.spec.ts › residence`: the `strict` helper defaults to `'limit'`, so the residence table keeps its expected values. `the Solvex case fails with the residence reason` becomes:

```ts
it('the Solvex case (a label) passes; the same place as a limit fails on residence', () => {
  const p = resident('MA', [], (x) => {
    x.locations.remote = [region('UK')];
  });
  expect(check([strict([country('GB')], 'label')], p).outcome).toBe('pass');
  expect(check([strict([country('GB')], 'limit')], p)).toMatchObject({
    outcome: 'fail',
    reason: 'job location (remote in GB, stated in the description) requires living there; you live in MA',
  });
});
```

- Rename `limit is strict too` to `a label is not checked against residence`, expecting `pass` for `strict([country('GB')], 'label')` with `resident('MA')`.
- [ ] **Step 2:** Run `npx nx test xjobs -- residence location`. Expected: the changed tests FAIL.
- [ ] **Step 3:** In `residenceApplies`, require `opening.placeStrictness === 'limit'`.
- [ ] **Step 4:** Set `MATCHER_VERSION = 11`; edit the two docs.
- [ ] **Step 5:** Run `npx nx test xjobs`. Expected: PASS.
- [ ] **Step 6:** Commit `fix(matcher): residence binds only on limit places`.

### PR 4 rollout

- [ ] **Step 1:** On dev, run Q1, Q2, Q7 (jobs failing residence only on a `label`); record them.
- [ ] **Step 2:** Push, `gh pr create`. Stop for merge and deploy.
- [ ] **Step 3:** After deploy, `db:rematch -- --all`; rerun Q1, Q2, Q7 and `db:match-shares -- --days 7`; post the after numbers. Expected: Q7 near 0; the label-only jobs (Remote Europe, Remote (US)…) qualify; review share not higher.

---

## Appendix: measurement queries (run on `10xjobs-dev` via `supabase-dev` `execute_sql`)

- **Q1, the leaks:** qualified matches in the last 7 days whose job facts' openings are not remote-only and that have no `MA` place (`facts::text ~ '"(countryCode|code)": "MA"'`) and `normalized_jobs."countryCode" <> 'MA'`, bucketed as remote-only / remote+other / hybrid-onsite-only / unstated (the query from the brainstorm; keep it verbatim in PR 1's body and reuse it).
- **Q2, outcomes:** `select outcome, count(*) from job_matches where "createdAt" >= now() - interval '7 days' group by 1`.
- **Q3, fill reach:** jobs with a LinkedIn location and an opening with no places, split by whether any opening has places; with the count already qualified.
- **Q4, case ids:** `job_fact_conflicts` (`field = 'arrangement'`, current extraction) joined to `normalized_jobs`, filtered by `quote ilike` each line in Task 5.
- **Q5, arrangement conflicts without arrangement words:** the brainstorm's conflict query with the keyword regex, split by `listingValue = 'remote'`.
- **Q6, reprocess ids:** the union of Q5's jobs, jobs on remote searches whose current facts have a description `label` or `limit` place, and Q1's jobs; output one id per line.
- **Q7, label-only residence failures:** matches whose location check has a `detail` entry with `residence.decided = true` and `placeStrictness = 'label'`, and no other failing rule.
