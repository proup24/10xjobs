# Residence Check for Strict Job Locations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A remote opening whose description ties it to places (`label` or `limit`) qualifies only users who live in one of those places.

**Architecture:** A new pure module `rules/residence.ts` computes a user's home places and whether they fall inside an opening's places. The location rule (`rules/location.ts`) runs it for the `remote` arrangement of description-sourced strict openings and combines it with the existing locations-list check, taking the worse outcome. No schema, facts or processor change.

**Tech Stack:** TypeScript (strict, nodenext), NestJS engine, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-17-residence-location-design.md`

## Global Constraints

- The check applies only when the arrangement is `remote`, `placesSource` is `description`, `placeStrictness` is `label` or `limit`, the opening has places, and the user has at least one home place.
- Home places are `residenceCountry` plus the `place` of each `residency` authorization. Citizenship, work permits and clearances never count.
- A user with no home places gets exactly today's outcome.
- An unplaceable job place or home code gives `unknown`, never `fail`.
- LinkedIn-sourced places, `mention` and `unstated` openings, and the `hybrid` and `onsite` arrangements are untouched.
- `MATCHER_VERSION` goes from 6 to 7.
- No Linear tickets (the project uses no tracker).

## Review Focus

1. A home code the index cannot place (a typo such as `XX`, or `UK`, which is a region, not ISO) should give `unknown`, not a sure reject. Test: Task 1, `livesIn` "an unplaceable home is maybe".
2. A job with one strict opening the user fails and another opening that fits (a `mention`, or a strict place they live in) should pass, because the best opening wins. Test: Task 2, "another opening still fits".
3. An opening offering `["remote", "hybrid"]` whose remote side fails on residence but whose hybrid side fits the hybrid list should pass. Test: Task 2, "a fitting hybrid side survives a remote residence failure".
4. When residence fits but the time zone does not, the failure is still on time zones, as today. Test: Task 2, "time zones still fail after a residence pass".
5. A residency authorization for a region (for example `EU`) should count for a job in one of its countries. Test: Task 1, `livesIn` "a home region covers its countries".

---

### Task 1: Home places and the residence fit

**Files:**

- Create: `apps/xjobs/src/modules/matcher/rules/residence.ts`
- Modify: `apps/xjobs/src/modules/matcher/rules/places.ts` (export `countriesOf`, unchanged otherwise)
- Test: `apps/xjobs/src/modules/matcher/rules/residence.spec.ts`

Before starting, create the branch and commit the approved spec with this plan:

```bash
git switch -c feat/residence-location
git add docs/superpowers/specs/2026-11-17-residence-location-design.md docs/superpowers/plans/2026-11-17-residence-location.md
git commit -m "docs(spec): residence check for strict job locations"
```

**Interfaces:**

- Consumes: `countriesOf(place, idx): Set<string> | null`, `Overlap`, `PlaceIndex` from `./places`; `MatchEligibility` from `./types`; `FactOpening` from `src/modules/facts/schema/facts`.
- Produces:
  - `homePlaces(eligibility: MatchEligibility): string[]`: `residenceCountry` first, then each `residency` authorization's place; upper-cased, de-duplicated.
  - `residenceApplies(opening: FactOpening, homes: string[]): boolean`: true when `placesSource === 'description'`, `placeStrictness` is `label` or `limit`, `places.length > 0` and `homes.length > 0`. It does not look at arrangements; the caller checks for `remote`.
  - `livesIn(places: FactOpening['places'], homes: string[], idx: PlaceIndex): Overlap`: `yes` if any home is inside any job place, else `maybe` if any pair could not be placed, else `no`.

- [ ] **Step 1: Write the failing tests** in `residence.spec.ts`, with this index:

```ts
const idx: PlaceIndex = {
  countriesOfRegion: new Map([
    ['EU', new Set(['FR', 'DE'])],
    ['EUROPE', new Set(['FR', 'DE', 'GB'])],
    ['EMEA', new Set(['FR', 'DE', 'GB', 'MA'])],
  ]),
  countryOfCity: new Map(),
  countries: new Set(['MA', 'FR', 'DE', 'GB', 'US', 'CA']),
};
const country = (code: string) => ({ kind: 'country' as const, code });
const region = (code: string) => ({ kind: 'region' as const, code });
const berlin = { kind: 'city' as const, name: 'Berlin', countryCode: 'DE', cityId: null };
```

`homePlaces`:

- "takes residence first, then residency authorizations only": `{ residenceCountry: 'ma', authorizations: [{ kind: 'residency', place: 'FR' }, { kind: 'citizenship', place: 'US' }, { kind: 'work-permit', place: 'CA' }, { kind: 'residency', place: 'MA' }] }` gives `['MA', 'FR']`.
- "is empty with no residence and no residency": `{ residenceCountry: null, authorizations: [{ kind: 'citizenship', place: 'FR' }] }` gives `[]`.

`residenceApplies` (build openings like `location.spec.ts`'s `opening()` helper):

- "applies to description label and limit": `label` and `limit` with `[country('GB')]` and homes `['MA']` give `true`.
- "skips mention, LinkedIn places, no places, no homes": `mention` gives false; `placesSource: 'linkedin'` gives false; `places: []` with `unstated` gives false; homes `[]` gives false.

`livesIn`:

- "a country is matched exactly": `[country('GB')]` gives `yes` for `['GB']` and `no` for `['MA']`.
- "several places, any one": `[country('US'), country('CA')]` gives `yes` for `['CA']` and `no` for `['MA']`.
- "a region contains its countries": `[region('EUROPE')]` gives `yes` for `['GB']`, `no` for `['MA']`; `[region('EU')]` gives `no` for `['GB']`; `[region('EMEA')]` gives `yes` for `['MA']`.
- "a city counts by its country": `[berlin]` gives `yes` for `['DE']` and `no` for `['MA']`.
- "worldwide always fits": `[{ kind: 'worldwide' }]` gives `yes` for `['MA']`.
- "an unknown region is maybe": `[region('NORDICS')]` gives `maybe` for `['MA']`.
- "an unplaceable home is maybe": `[country('GB')]` gives `maybe` for `['XX']` and for `['UK']`.
- "a home region covers its countries": `[country('FR')]` gives `yes` for `['EU']`.
- "any yes wins over maybe": `[region('NORDICS'), country('MA')]` gives `yes` for `['MA']`.

- [ ] **Step 2:** Run `npx nx test xjobs -- rules/residence`. Expected: FAIL, the module does not exist.

- [ ] **Step 3: Implement** `residence.ts` and export `countriesOf` from `places.ts`.

A home code becomes a profile place: `region` when `idx.countriesOfRegion` has it, `country` when `idx.countries` has it and it is not a region, otherwise unplaceable (`maybe`). Each job place becomes a country set with `countriesOf`. `worldwide` is `yes`, and a `null` set is `maybe`. A home inside a job place means the two sets intersect.

- [ ] **Step 4:** Run `npx nx test xjobs -- rules/residence rules/places`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/xjobs/src/modules/matcher/rules/residence.ts apps/xjobs/src/modules/matcher/rules/residence.spec.ts apps/xjobs/src/modules/matcher/rules/places.ts
git commit -m "feat(matcher): home places and the residence fit"
```

---

### Task 2: The location rule checks residence

**Files:**

- Modify: `apps/xjobs/src/modules/matcher/rules/location.ts` (`checkArrangement`, `openingUnsure`, `checkOpening`, `checkLocation`)
- Modify: `apps/xjobs/src/modules/matcher/config/matcher.config.ts` (`MATCHER_VERSION = 7`)
- Test: `apps/xjobs/src/modules/matcher/rules/location.spec.ts` (new `describe('residence')` block)
- Test: `apps/xjobs/src/modules/matcher/rules/decide.spec.ts` (one end-to-end case)

**Interfaces:**

- Consumes: `homePlaces`, `residenceApplies`, `livesIn` from Task 1.
- Produces:
  - `FailedOn` gains `'residence'`.
  - Each entry of the location check's `detail` gains `residence: { homes: string[]; fits: Overlap } | null`, which is null when `residenceApplies` is false.

Behaviour of `checkArrangement` for `arrangement === 'remote'` when `residenceApplies(opening, homes)` holds. Compute the list outcome as today, then apply `livesIn`:

| list outcome    | `livesIn` | result    | `failedOn`          |
| --------------- | --------- | --------- | ------------------- |
| fail            | any       | fail      | `places` (as today) |
| pass or unknown | `no`      | fail      | `residence`         |
| pass            | `maybe`   | unknown   | null                |
| unknown         | `maybe`   | unknown   | null                |
| pass or unknown | `yes`     | unchanged | null                |

The time-zone check then runs exactly as today. In `openingUnsure`, a `residence` failure counts as unsure when `opening.confidence === 'unsure'`, the same way a description `places` failure does. Compute `homes` once per `checkLocation` call.

Reason: when the overall outcome is `fail` and any opening's `remote` result failed on `residence`, the reason is

```
job location (<jobText>, stated in the description) requires living there; you live in <homes joined by ", ">
```

where `<jobText>` is the existing text (for example `remote in GB`). Every other case keeps today's reason.

- [ ] **Step 1: Write the failing tests** in a new `describe('residence')` block in `location.spec.ts`. Use its own index (the Task 1 index plus `countryOfCity` empty). Use a profile from `exampleProfile()` whose remote list stays `worldwide`, so only residence decides, with `eligibility.residenceCountry` set per case. Use a `strict(places, strictness = 'label')` helper for a sure remote opening sourced from the description.

The spec's table, as one test per resident with `outcome` asserted for each place:

| Resident | `[US]` | `[US, CA]` | `[EUROPE]` | `[EU]` | `[EMEA]` | `[Berlin city, DE]` |
| -------- | ------ | ---------- | ---------- | ------ | -------- | ------------------- |
| MA       | fail   | fail       | fail       | fail   | pass     | fail                |
| DE       | fail   | fail       | pass       | pass   | pass     | pass                |
| US       | pass   | pass       | fail       | fail   | fail     | fail                |
| GB       | fail   | fail       | pass       | fail   | pass     | fail                |

Then:

- "the Solvex case fails with the residence reason": the profile's remote list is `[region('UK')]` with `UK` in the index (`UK` gives `{GB}`), residence `MA`, opening `strict([country('GB')])`. Expect `outcome: 'fail'`, `unsure: false` and `reason` equal to `job location (remote in GB, stated in the description) requires living there; you live in MA`. Expect `detail[0].residence` equal to `{ homes: ['MA'], fits: 'no' }`.
- "limit is strict too": `strict([country('GB')], 'limit')`, resident MA, gives `fail`.
- "no residence keeps today's outcome": residence null and no authorizations, `strict([country('GB')])`, gives `pass`, and `detail[0].residence` is `null`.
- "a residency authorization counts, citizenship does not": residence MA plus `{ kind: 'residency', place: 'GB' }` gives `pass`. Residence MA plus only `{ kind: 'citizenship', place: 'GB' }` gives `fail`.
- "mention and LinkedIn places are not checked": resident MA; `strict([country('GB')], 'mention')` gives `pass`; `{ ...strict([country('GB')]), placesSource: 'linkedin' }` gives `pass`.
- "an unknown region goes to review, not reject": `strict([region('NORDICS')])`, resident MA, gives `unknown`.
- "onsite and hybrid are not checked": a profile with remote `[]` and onsite `[country('GB')]`, resident MA, and an onsite opening `[country('GB')]` with `limit`, gives `pass`.
- "an unsure opening's residence failure is unsure": `{ ...strict([country('GB')]), confidence: 'unsure' }`, resident MA, gives `fail` with `unsure: true` and `unsureField: 'openings'`.
- Review Focus 2, "another opening still fits": resident MA, openings `[strict([country('GB')]), strict([country('MA')])]` give `pass`; `[strict([country('GB')]), strict([country('GB')], 'mention')]` give `pass`.
- Review Focus 3, "a fitting hybrid side survives a remote residence failure": a profile with remote `worldwide` and hybrid `[country('GB')]`, resident MA, and the opening `{ ...strict([country('GB')]), arrangements: ['remote', 'hybrid'] }`. Expect `pass` and `detail[0].decidedBy === 'hybrid'`.
- Review Focus 4, "time zones still fail after a residence pass": resident GB, `{ ...strict([country('GB')]), timezones: [{ fromUtc: 9, toUtc: 10, label: 'x' }] }`, with the example profile's −300..300 range, gives `fail`. The reason is not the residence reason.

In `decide.spec.ts`, add "rejects a UK-only remote job for a Moroccan resident": profile remote `[{ kind: 'region', code: 'UK' }]` with a copy of the file's shared context whose `places.countriesOfRegion` has `UK` → `{GB}` and whose `places.countries` has `GB` and `MA` (the shared one is empty), residence `MA`, and a `factsDoc` edited to one description opening `{ ["remote"], [country GB], label }`. Expect outcome `rejected`, and the `location` check with `outcome: 'fail'` and the residence reason. Follow the file's existing pattern for building the context and profile.

- [ ] **Step 2:** Run `npx nx test xjobs -- rules/location rules/decide`. Expected: the new residence tests FAIL (outcomes pass where fail is expected, `detail[0].residence` undefined), and the existing tests pass.

- [ ] **Step 3: Implement** the behaviour above in `location.ts`, and set `MATCHER_VERSION = 7` in `matcher.config.ts`.

- [ ] **Step 4:** Run `npx nx test xjobs -- matcher`. Expected: PASS, including every existing location, decide and matcher service test.

- [ ] **Step 5:** Run `npx nx run-many -t lint test build typecheck`. Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add apps/xjobs/src/modules/matcher/rules/location.ts apps/xjobs/src/modules/matcher/rules/location.spec.ts apps/xjobs/src/modules/matcher/rules/decide.spec.ts apps/xjobs/src/modules/matcher/config/matcher.config.ts
git commit -m "feat(matcher): strict description places require living there"
```

- [ ] **Step 7:** Push with `git push -u origin feat/residence-location` and open the PR to `main` with `gh pr create`. In the body, list the rollout steps below as post-merge items.

---

## After merge (human merges; then on dev)

1. Wait for the Deploy engine workflow to roll out the new matcher.
2. Record a baseline with `pnpm --filter @xjobs/xjobs db:match-shares -- --days 7`.
3. Run `pnpm --filter @xjobs/xjobs db:rematch -- --all` against dev (needs `XJOBS_ALLOW_REMOTE_DB=1`).
4. Run `db:match-shares` again. Expected: for the Moroccan profile, the roughly 43 qualified matches from description-stated foreign places (19 `limit` and 24 `label` on 2026-11-16) move to rejected. The roughly 50 LinkedIn-only ones stay qualified, and the review share does not grow noticeably.
5. Spot-check job `01a1e54f-03ac-741f-9509-d23497358c7e`: its match is `rejected` with the residence reason.
