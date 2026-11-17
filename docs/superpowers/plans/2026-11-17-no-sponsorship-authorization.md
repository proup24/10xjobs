# "No sponsorship" means authorization where the job is: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a job says it offers no sponsorship and states no authorization requirement of its own, require a work permit for where the job is, and reject users who hold none for that place.

**Architecture:** The facts layer (`combine.ts`) derives `work-permit` requirements marked `derived: 'no-sponsorship'`. It takes the places from the description's openings first and falls back to the LinkedIn place. The matcher's work-authorization rule treats the derived requirements as alternatives (any one met is enough) and gives them their own reasons. A `FACTS_VERSION` bump and a `MATCHER_VERSION` bump let the 60-second sweep rebuild and re-decide existing jobs.

**Tech Stack:** NestJS engine, TypeScript strict, Zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-17-no-sponsorship-authorization-design.md`

## Global Constraints

- The processor, its prompt and the shared `workAuthorizationSchema` in `apps/xjobs/src/modules/processor/schema/shared.ts` stay unchanged.
- The derived marker is `derived: 'no-sponsorship'`, optional, on facts-layer requirements only.
- `FACTS_VERSION` goes from 4 to 5, and `MATCHER_VERSION` from 8 to 9.
- Reason copy, verbatim:
  - `you don't meet work-permit US (the job offers no sponsorship)`
  - `you don't meet work-permit in any of US, CA (the job offers no sponsorship)`
  - `you meet work-permit US (the job offers no sponsorship)`
  - `the job offers no sponsorship but names no place to check`
- Residence never counts as a work permit.
- Branch: `feat/no-sponsorship-authorization` from an up-to-date `origin/main`. The PR goes to `main`.

## Review Focus

1. **A description place that maps to no code** (a city with `countryCode: null`): if the description yields no codes, fall back to the LinkedIn place rather than deriving nothing. Test in Task 1.
2. **A lower-case code from the processor** (`"us"`): codes are upper-cased before de-duplicating, so `us` and `US` become one requirement. Test in Task 1.
3. **Only `mention` places plus a LinkedIn place:** the mention is skipped and the LinkedIn place is used. Test in Task 1.
4. **An unsure `workAuthorization` fact with a derived failure:** it must be an unsure failure (review), never a sure reject. Test in Task 2.
5. **Old facts rows without the marker** must still parse, and a row with it must pass `jobFactsDocumentSchema`. Test in Task 1.

---

### Task 0: Branch

- [ ] **Step 1:** `git fetch origin && git switch -c feat/no-sponsorship-authorization origin/main`. Leave the unrelated untracked files and `.claude/settings.json` uncommitted.
- [ ] **Step 2:** Commit the spec and this plan:

```bash
git add docs/superpowers/specs/2026-11-17-no-sponsorship-authorization-design.md docs/superpowers/plans/2026-11-17-no-sponsorship-authorization.md
git commit -m "docs: spec and plan for no-sponsorship work authorization"
```

### Task 1: Derive requirements in facts

**Files:**

- Create: `apps/xjobs/src/modules/facts/rules/no-sponsorship.ts`
- Create: `apps/xjobs/src/modules/facts/rules/no-sponsorship.spec.ts`
- Modify: `apps/xjobs/src/modules/facts/schema/facts.ts` (the `workAuthorization` entry)
- Modify: `apps/xjobs/src/modules/facts/rules/combine.ts` (`combineFacts`, the `workAuthorization:` line)
- Modify: `apps/xjobs/src/modules/facts/config/facts.config.ts` (`FACTS_VERSION = 5`, plus a line in its doc comment)
- Test: `apps/xjobs/src/modules/facts/rules/combine.spec.ts`

**Interfaces:**

- Produces, in `facts.ts`:
  - `factWorkAuthorizationSchema`: `workAuthorizationSchema` with each requirement extended by `derived: z.literal('no-sponsorship').optional()`. `workAuthorization: sourcedFactSchema(factWorkAuthorizationSchema)`.
  - `export type FactWorkAuthorization = z.infer<typeof factWorkAuthorizationSchema>`
- Produces, in `no-sponsorship.ts`:
  - `export function deriveFromNoSponsorship(value: FactWorkAuthorization | null, described: FactOpening[], listingPlace: ResolvedPlace | null): FactWorkAuthorization | null`
- `described` is the openings as `descriptionOpening` builds them, before `combineOpenings` adds the LinkedIn place. `listingPlace` is `listing.place`.

- [ ] **Step 1: Write the failing tests** in `no-sponsorship.spec.ts`, one `it` each:
  - `null` value → `null`.
  - `sponsorship` `yes` or `unstated` → returned unchanged.
  - `sponsorship: 'no'` with an explicit requirement → returned unchanged.
  - Description country `US` → `requirements: [{ kind: 'work-permit', place: 'US', derived: 'no-sponsorship' }]`, `sponsorship: 'no'`.
  - A city Paris (`countryCode: 'FR'`) plus a region `EU` → places `['FR', 'EU']`, in opening order.
  - Two openings `US` and `us` → one requirement `US`.
  - No description places, `listingPlace` `{ kind: 'country', code: 'US' }` → `US`. This is the shape of job `01a1e587`: one opening with a time zone and `places: []`.
  - Description places that are only `placeStrictness: 'mention'`, plus a LinkedIn `US` → `US`.
  - A description city with `countryCode: null`, plus a LinkedIn `US` → `US`.
  - Description places present → the LinkedIn place is ignored (description `FR`, listing `US` → `FR` only).
  - A `worldwide` place (description, or LinkedIn on the fallback) → unchanged (`requirements: []`).
  - No places anywhere → unchanged.
- [ ] **Step 2:** Run `npx nx test xjobs -- src/modules/facts/rules/no-sponsorship.spec.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `factWorkAuthorizationSchema` and `deriveFromNoSponsorship`. Code mapping: a country gives `code`, a region gives `code`, a city gives `countryCode` (skipped when null), and each is upper-cased. Worldwide in the chosen source gives nothing. Use the LinkedIn place only when the description's non-`mention` openings yield no code and no worldwide.
- [ ] **Step 4:** In `combineFacts`, set `workAuthorization` to `fromDescription(extraction.workAuthorization)` with its `value` replaced by `deriveFromNoSponsorship(value, described, listing.place)`. Keep `quote`, `confidence` and `source`. Set `FACTS_VERSION = 5`, and add "a change to how requirements are derived from no sponsorship" to the doc comment.
- [ ] **Step 5: Add to `combine.spec.ts`:**
  - `it('derives a work permit from no sponsorship and the listing place')`. Extraction: `workAuthorization` value `{ requirements: [], sponsorship: 'no' }`, quote `'no sponsorship available'`, and one opening with a time zone. Listing place `US`. Assert `facts.workAuthorization` equals `{ value: { requirements: [{ kind: 'work-permit', place: 'US', derived: 'no-sponsorship' }], sponsorship: 'no' }, quote: 'no sponsorship available', confidence: 'sure', source: 'description' }`.
  - The existing `'the result parses with jobFactsDocumentSchema'` case, or a new one: a document with a derived requirement parses, and a document whose requirements have no `derived` key still parses.
- [ ] **Step 6:** Run `npx nx test xjobs -- src/modules/facts` and `npx nx typecheck xjobs`. Expected: PASS.
- [ ] **Step 7: Commit:** `feat(facts): derive a work permit from no sponsorship`

### Task 2: Judge derived requirements in the matcher

**Files:**

- Modify: `apps/xjobs/src/modules/matcher/rules/work-authorization.ts`
- Modify: `apps/xjobs/src/modules/matcher/config/matcher.config.ts` (`MATCHER_VERSION = 9`)
- Modify: `apps/xjobs/src/modules/matcher/README.md` (the work authorization section, and the "nothing to check" sentence near line 33)
- Test: `apps/xjobs/src/modules/matcher/rules/work-authorization.spec.ts`

**Interfaces:**

- Consumes: `FactWorkAuthorization` from Task 1. `JobFactsDocument['workAuthorization']['value']` now carries the optional `derived`.
- `checkWorkAuthorization(facts, profile, idx): Check` keeps its signature.

- [ ] **Step 1: Write the failing tests.** Extend the spec's `doc` helper so a requirement can carry `derived` (for example a `derivedDoc(places: string[], confidence?)` that builds `work-permit` derived requirements with `sponsorship: 'no'`). Then add:
  - `it('a derived requirement the user meets passes')`. `derivedDoc(['US'])` with `auth('citizenship', 'US')` gives `outcome: 'pass'` and `reason: 'you meet work-permit US (the job offers no sponsorship)'`.
  - `it('derived requirements are alternatives: one met is enough')`. `derivedDoc(['US', 'CA'])` with `auth('work-permit', 'CA')` → `pass`, `reason: 'you meet work-permit CA (the job offers no sponsorship)'`.
  - `it('an unmet derived requirement fails')`. `derivedDoc(['US'])` with residence `MA` and `auth('residency', 'MA')` gives `fail` and `reason: "you don't meet work-permit US (the job offers no sponsorship)"`.
  - `it('several unmet derived requirements fail naming each')`. `derivedDoc(['US', 'CA'])` with no authorizations → `reason: "you don't meet work-permit in any of US, CA (the job offers no sponsorship)"`.
  - `it('residence alone never meets a derived work permit')`. `derivedDoc(['US'])` with `residenceCountry: 'US'` and no authorizations → `fail`.
  - `it('sponsorship acceptance does not rescue a derived requirement')`. `acceptsSponsorship: true` and no authorizations → `fail`.
  - `it('a derived requirement the index cannot place is unknown')`. `derivedDoc(['XX'])` with `auth('work-permit', 'FR')` → `unknown`.
  - `it('an unmet derived requirement on an unsure fact is an unsure failure')`. `derivedDoc(['US'], 'unsure')` → `fail` with `unsure: true` and `unsureField: 'workAuthorization'`. This is Review Focus 4.
  - `it('no sponsorship with nothing derived names no place')`. `doc([], 'no')` → `pass`, `reason: 'the job offers no sponsorship but names no place to check'`.
  - The existing `'no requirements passes: nothing to check'` keeps `'job states no work authorization requirement'` for `sponsorship: 'unstated'`.
- [ ] **Step 2:** Run `npx nx test xjobs -- src/modules/matcher/rules/work-authorization.spec.ts`. Expected: the new cases FAIL.
- [ ] **Step 3: Implement.** In `checkWorkAuthorization`, split `requirements` into explicit (no `derived`) and derived. Explicit requirements go through today's path unchanged.
  - When there are derived requirements, the group is the best `meets` over them (`yes` > `maybe` > `no`):
    - `yes` → pass, naming the first met place.
    - `maybe` (none met) → `unknown` with `reason: \`cannot tell whether you meet work-permit ${places} (the job offers no sponsorship)\``and`restsOn(null)`.
    - `no` → fail.
  - Carry `detail: { unmet, unclear }` and `sureness` as the explicit path does.
  - Empty requirements with `sponsorship === 'no'` use the new no-place reason; otherwise keep the old one.
  - Set `MATCHER_VERSION = 9`.
- [ ] **Step 4:** Run `npx nx test xjobs -- src/modules/matcher` and `npx nx typecheck xjobs`. Expected: PASS. `decide.spec.ts` may pin the old reason; update only cases that use `sponsorship: 'no'` with no requirements.
- [ ] **Step 5: README.** Under **Work authorization**, add a paragraph saying:
  - When the job offers no sponsorship and states no requirement, the facts derive `work-permit` requirements for the description's non-mention places, else the LinkedIn place.
  - Any one met is enough, and neither residence nor sponsorship acceptance meets them.
  - The derived reasons, as listed under Global Constraints.

  In the sentence near line 33, note that "no work authorization requirement" now excludes a no-sponsorship job with a place.

- [ ] **Step 6:** Run `npx nx run-many -t lint test build typecheck`. Expected: all green. `next build` may die on `SecurityFatalError`, a known flake; re-run it.
- [ ] **Step 7: Commit:** `feat(matcher): judge work permits derived from no sponsorship`

### Task 3: PR and dev rollout

- [ ] **Step 1:** `git push -u origin feat/no-sponsorship-authorization`, then `gh pr create --base main`. In the body, cover the problem (job `01a1e587-e858-7498-847e-e1800e21b7f9`), the two version bumps, and the post-merge checks below.
- [ ] **Step 2: After the merge and deploy, check on dev** through the `supabase-dev` MCP, read-only:
  - Facts for `01a1e587-e858-7498-847e-e1800e21b7f9` show `factsVersion = 5` and a derived `work-permit US`.
  - Its `job_matches` row for the owner's profile is `rejected`, with the derived fail reason.
  - About 10 jobs (`sponsorship = 'no'`, originally no requirements) now carry derived requirements. Spot-check two for wrong places.
  - Run `pnpm --filter @xjobs/xjobs db:match-shares -- --days 7`; review stays the exception.
