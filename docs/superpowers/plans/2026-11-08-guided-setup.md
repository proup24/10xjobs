# Guided Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A first-time user walks through five saved steps (about you, where you can work, the job you want, location and terms, resume) plus a review, ending with their eligibility, a complete draft profile with its tech stack, and a resume.

**Architecture:** Steps 1–2 write the user's own rows through `supabase-js` and RLS. Steps 3–4 write a per-user setup draft (`profile_setup_drafts`); finishing step 4 calls a security-invoker function that creates the profile and its skills and deletes the draft in one transaction. Once the profile exists, steps 3–4 edit it directly. The next step is derived from saved data. All UI is built from `components/ui` and theme tokens; three missing controls are added to the library first.

**Tech Stack:** Next.js 16 App Router (server components, server actions), `@supabase/ssr` / `supabase-js` 2, Prisma contract and migrations (`@prisma/orm-postgres`, `rawSql` ops), plpgsql, shadcn/ui (base-nova, Base UI) on Tailwind v4, zod 4, Vitest with Testing Library (`fireEvent`, no user-event), `apps/db-tests` against the Supabase CLI stack.

**Spec:** `docs/superpowers/specs/2026-11-08-guided-setup-design.md`. UI rules: `apps/web/DESIGN.md`.

**Linear ticket:** none (this project uses no ticket tracker).

**Branches and PRs** (branch from `docs/guided-setup-spec`, which carries the spec; this plan is committed there too):

- **PR 1 `feat/setup-foundation`** (Tasks 1–6): the searchable-tech source, the draft table and functions, the three library components, and the setup logic in `src/lib/setup`. No visible flow yet; `/setup` keeps its placeholder.
- **PR 2 `feat/guided-setup`** (Tasks 7–12): routing and guards, the five step screens, the review, roadmap edits. Branch from `main` after PR 1 merges.

## Global Constraints

- **UI**: only `src/components/ui` components and role tokens (`DESIGN.md` "Rules"). No raw `<button>`, `<input>`, `<select>`, `<textarea>`, no literal colors, no arbitrary values in pages or feature components. A missing control is added to `components/ui`, the `/design` page and `DESIGN.md` before use.
- **Focus recipes** copied as is: clickables `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring`; fields `focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring`. Text inputs `text-base md:text-sm`.
- **Responsive**: desktop-first, checked at 360px, nothing scrolls sideways. Rows (tech, language, place, authorization) stack below `sm`.
- **Writes** go through the signed-in session client only (`createSupabaseServerClient`); never the service role (`src/no-service-role.spec.ts`). Web imports only `@xjobs/database/enums` and `@xjobs/database/types` (ESLint rule).
- **Stored values** (spec, exact):
  - `mastery = rating × 2` (rating 1–5); reading back, `rating = clamp(round(mastery / 2), 1, 5)`.
  - `importance = 10` when starred, `5` otherwise; reading back, `starred = importance > 5`. At most 2 starred, only searchable techs.
  - Domain by position: `backend_engineer`→`backend`, `frontend_engineer`→`frontend`, `fullstack_engineer`→`fullstack`, `mobile_engineer`→`mobile`, `devops_engineer`/`site_reliability_engineer`/`platform_engineer`/`cloud_engineer`→`devops`, `data_engineer`→`data`, `ml_engineer`/`ai_engineer`→`ml`, `security_engineer`→`security`, `qa_engineer`→`qa`, anything else→`backend`.
  - Notice options (days): Immediately 0, 1 week 7, 2 weeks 14, 1 month 30, 2 months 60, 3 months 90, 6 months 180.
  - Time zone offsets offered (minutes): every whole hour from −720 to +840, plus −570, −210, +210, +270, +330, +345, +390, +525, +570, +630, +765. Prefill: current = browser offset (`-new Date().getTimezoneOffset()`), range = current ± 180, clamped to [−720, 840].
  - Work authorization kinds: Citizenship `citizenship`, Residency `residency`, Work permit `work-permit`, Security clearance `clearance`. Places: countries and regions except `GLOBAL`.
  - Location places: `{kind:'worldwide'}` (Remote only), regions except `GLOBAL`, countries, cities (label "name, country label"). At most 20 per arrangement, no duplicates, at least one place overall, each row at least one arrangement.
  - Lists exclude `unstated` (seniorities, contract types, engagements); positions are approved `isEngineering` role kinds.
  - Salary all-or-nothing: integer > 0, ISO 4217 currency, period `hour`/`day`/`month`/`year`. Currencies: `acceptsAnyCurrency` true with empty list, or false with ≥ 1.
- **Copy** (exact):
  - Step 3 lead: "We only show you jobs that match every answer here."
  - Tech stack description: "Add every tech you'd be happy to work with; jobs that need something not on this list are skipped."
  - Rating ends: "1 = learning · 5 = expert". Star: "Search for this".
  - Sponsorship: "Would you take a job that sponsors your visa?"
  - No authorizations tick: "I don't hold any work authorization". Suggestion: "Add residency in <country>?"
- **Migrations**: `pnpm --filter @xjobs/database db:migration:plan` after editing the contract, edit only the `operations` getter, self-emit with `node <package>/migration.ts`. Never edit an existing migration. Hand-written SQL follows the same-hash `rawSql` shape of `20261105T2208_code_check_fixes/migration.ts` (`operationClass: 'data'`, an `invariantId`, the invariant added to `refs/db.json`, keeping every existing invariant). Then `pnpm db:types`.
- **CI**: `npx nx run-many -t lint test build typecheck` and `pnpm db:test` green. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Claude doesn't push.

## Review Focus

1. **Double submit on step 4** (two clicks, two tabs). Expected: exactly one profile; the second call finds no draft and the flow moves on to the resume step. Test in Task 2 (`second call after success raises P0002 and creates nothing`) and Task 6 (`saveTerms treats a missing draft as already created`).
2. **A profile created outside setup** (engine endpoints, seeds) with mastery 7, importance 8 or notice 45 days, opened in steps 3–4. Expected: the form shows rating 4, starred, "1 month" (nearest option, ties to the shorter), and saving doesn't fail. Test in Task 5 (`fromProfile`).
3. **Step 4 creation refused by a database check** (for example, a city that was valid in the draft but the trigger refuses). Expected: the draft is kept with the terms just entered, the user stays on step 4 and sees the message; nothing half-created. Test in Task 2 (`invalid profile leaves the draft and writes nothing`) and Task 6.
4. **URL typed ahead** (`/setup/resume` before step 2 is done) or back after finishing. Expected: redirect to the next unfinished step; a finished user at `/setup` goes to `/`, while step URLs and `/setup/review` stay open for edits. Test in Task 7.
5. **Changing the position after the profile exists.** Expected: every skill's domain follows on save, and nothing else in the stack changes. Test in Task 6 (`saveJob on an existing profile replaces skills with the new domain`).

---

## PR 1: Foundation

### Task 1: One source for searchable techs

**Files:**

- Create: `libs/database/src/enums/technology-terms.ts` (moved from `apps/xjobs/src/modules/queries/builders/keywords.ts`: the `TECHNOLOGY_TERMS` map, unchanged).
- Modify: `libs/database/src/enums/index.ts` (export it), `apps/xjobs/src/modules/queries/builders/keywords.ts` (re-export or import from `@xjobs/database/enums`; keep the engine's imports compiling), `libs/database/src/seeds/vocab/seed-data.spec.ts`.
- Test: `libs/database/src/seeds/vocab/seed-data.spec.ts`

**Interfaces:**

- Produces: `TECHNOLOGY_TERMS: Readonly<Record<string, string>>` and `isSearchableTech(code: string): boolean` (`Object.hasOwn`) from `@xjobs/database/enums`. The engine's `hasSearchWording` delegates to `isSearchableTech`.

- [ ] **Step 1: Write the failing test** in `seed-data.spec.ts`: `every TECHNOLOGY_TERMS key is a seeded tech tag code` (`Object.keys(TECHNOLOGY_TERMS)` ⊆ `SEED.techTags` codes), and `isSearchableTech('typescript') === true`, `isSearchableTech('saas') === false`.
- [ ] **Step 2: Run** `npx nx test database -- seed-data`. Expected: FAIL (no export).
- [ ] **Step 3: Move the map** and wire the exports as listed.
- [ ] **Step 4: Run** `npx nx run-many -t test typecheck -p database xjobs`. Expected: PASS, including `expand.scenarios.spec.ts` and `channels.spec.ts` unchanged.
- [ ] **Step 5: Commit** `refactor(database): share the searchable tech list with the web app`

### Task 2: Setup draft table and profile functions

**Files:**

- Modify: `libs/database/src/contract/contract.prisma`: add

  ```prisma
  // Answers to setup steps 3–4 until the profile can be created; one per user.
  model ProfileSetupDraft {
    id      Uuid  @id @onCreate(uuid(7))
    userId  Uuid  @unique
    user    User  @relation(fields: [userId], references: [id], onDelete: Cascade)
    answers Jsonb
    +Timestamps

    @@map("profile_setup_drafts")
    @@rls
  }

  policy_all profile_setup_drafts_owner {
    target = ProfileSetupDraft
    roles = [authenticated]
    using = sql`"userId" = auth.uid()`
    withCheck = sql`"userId" = auth.uid()`
  }
  ```

- Create: migration package via `db:migration:plan` (`<ts>_profile_setup_drafts`) plus a `rawSql` op for the two functions; `refs/db.json` gains `"profile-setup-functions"`.
- Modify: `apps/db-tests/src/support/registry.ts` (add the table), `apps/db-tests/src/support/fixtures.ts` (`seedSetupDraft(userId, answers = { version: 1 })`), `libs/database/src/supabase/database.types.ts` (regenerated).
- Test: `apps/db-tests/src/setup-draft.db.spec.ts`

**Interfaces:**

- Produces:
  - Table `profile_setup_drafts` (`id`, `userId` unique, `answers` jsonb, timestamps).
  - `public.create_profile_from_setup(p_profile jsonb, p_skills jsonb) RETURNS uuid`. `p_profile` has the user-writable profile columns (`position`, `yearsOfExperience`, `timezoneCurrent`, `timezoneMin`, `timezoneMax`, `engagements`, `seniorities`, `noticePeriodDays`, `contractTypes`, `locations`, `languages`, `salaryMin`, `salaryCurrency`, `salaryPeriod`, `acceptsAnyCurrency`, `acceptedCurrencies`); `p_skills` is an array of `{ technology, domain, mastery, importance }`.
  - `public.replace_profile_skills(p_profile_id uuid, p_skills jsonb) RETURNS void`.

- [ ] **Step 1: Write the failing tests** in `setup-draft.db.spec.ts`, every call through `TestUser.client`:
  - `create_profile_from_setup creates the profile and skills and deletes the draft`: seed a draft for `a`; rpc with `profileFields()` and two skills; returns an id; `profiles` row has `userId = a.id`, `state = 'draft'`; two `profile_skills` rows; the draft is gone.
  - `second call after success raises P0002 and creates nothing`: call again; `error.code === 'P0002'`; still one profile.
  - `invalid profile leaves the draft and writes nothing`: `contractTypes: ['unknown']`; error; no profile, no skills, draft still there.
  - `cannot use another user's draft`: only `b` has a draft; `a` calls; `P0002`; `b`'s draft untouched; no profile for either.
  - `replace_profile_skills swaps the stack on a draft`: then the stack equals the new list exactly.
  - `replace_profile_skills on a published profile changes nothing`: `publishProfile`; error; skills unchanged.
  - `replace_profile_skills on another user's profile changes nothing`.
  - Registry entry: `{ table: 'profile_setup_drafts', ownerColumn: 'userId', seed: seedSetupDraft, insertPayload: (userId) => ({ id: randomUUID(), userId, answers: { version: 1 } }), patch: { answers: { version: 1, job: null } }, canDelete: true }`. Note `userId` is unique: `seed` must remove the user's existing draft first (admin delete) so the suite can seed the same user twice.
- [ ] **Step 2: Run** `pnpm db:test -- setup-draft isolation`. Expected: FAIL (no table).
- [ ] **Step 3: Contract, plan, functions.** Both functions: `LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''`, `REVOKE EXECUTE … FROM PUBLIC, anon`, `GRANT EXECUTE … TO authenticated`. `create_profile_from_setup`: lock the caller's draft (`WHERE "userId" = auth.uid() FOR UPDATE`), `RAISE … USING ERRCODE = 'P0002'` if none; insert the profile with `"userId" = auth.uid()` and the columns above read from `p_profile` (`jsonb_populate_record(null::public.profiles, p_profile)` or explicit casts); insert skills from `jsonb_to_recordset(p_skills)`; delete the draft; return the id. `replace_profile_skills`: delete the caller's skills for that profile, insert the new ones; RLS (draft-only policies) refuses everything else. Errors propagate unchanged so trigger messages (field names) reach the web app.
- [ ] **Step 4: Migrate, regenerate, run:** `pnpm db:migrate`, `pnpm db:types`, `pnpm db:test`. Expected: PASS, including `rls-enabled` and the isolation suite for the new table.
- [ ] **Step 5: Commit** `feat(db): setup drafts and atomic profile creation`

### Task 3: Library: `toggle` and `toggle-group`

**Files:**

- Create: `apps/web/src/components/ui/toggle.tsx`, `toggle-group.tsx` via `pnpm --filter @xjobs/web exec shadcn add toggle toggle-group`, restyled onto roles.
- Modify: `apps/web/src/app/design/_sections/inputs.tsx` (examples: star toggle pressed/unpressed/disabled; a Remote/Hybrid/On-site multiple group with Hybrid and On-site disabled), `apps/web/DESIGN.md` ("Components": both entries in the existing format; "Use for" names the star and the place row).
- Test: `apps/web/src/components/ui/toggle.spec.tsx`, `a11y-recipes.spec.ts`

**Interfaces:**

- Produces: `Toggle` (`pressed`, `onPressedChange`, `disabled`, `aria-label`, variants `default`, `outline`, sizes `sm`, `default`); `ToggleGroup` (`multiple`, `value: string[]`, `onValueChange`) with `ToggleGroupItem` (`value`, `disabled`).

- [ ] **Step 1: Write the failing tests:** `toggle exposes aria-pressed and flips on click`; `disabled toggle ignores clicks`; `toggle group in multiple mode reports every pressed value`; in `a11y-recipes.spec.ts` add `toggle.tsx` and `toggle-group.tsx` to the clickable-outline list (pressed fill is `bg-accent text-accent-foreground`; no `outline-none` on the same element).
- [ ] **Step 2: Run** `npx nx test web -- toggle a11y-recipes`. Expected: FAIL.
- [ ] **Step 3: Add and restyle** the components; add the `/design` examples and guide entries.
- [ ] **Step 4: Run** `npx nx run-many -t test lint typecheck -p web`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): toggle and toggle group in the library`

### Task 4: Library: `rating-bar`

**Files:**

- Create: `apps/web/src/components/ui/rating-bar.tsx`
- Modify: `apps/web/src/app/design/_sections/inputs.tsx` (empty, set, invalid, disabled), `apps/web/DESIGN.md`.
- Test: `apps/web/src/components/ui/rating-bar.spec.tsx`, `a11y-recipes.spec.ts`

**Interfaces:**

- Produces: `RatingBar({ value: number | null, onValueChange(v: number), max = 5, lowLabel?, highLabel?, disabled?, 'aria-label'?, 'aria-invalid'? })`. A radio group (`role="radiogroup"`, five `role="radio"` items labelled `"1"`…`"5"`, roving tab index, ArrowLeft/ArrowRight move and select). Reads `Field` wiring like `RadioGroup`. Field focus recipe on items.

- [ ] **Step 1: Write the failing tests:** `renders five radios with none checked when value is null`; `click selects and calls onValueChange(4)`; `ArrowRight from 3 selects 4`; `inside an invalid Field it gets aria-invalid and aria-describedby`; a11y recipe check lists `rating-bar.tsx` under fields.
- [ ] **Step 2: Run** `npx nx test web -- rating-bar`. Expected: FAIL.
- [ ] **Step 3: Implement** on Base UI's radio group primitives (as `radio-group.tsx` does), styled as a joined segmented bar (`rounded-sm`, `border-input`, checked `bg-primary text-primary-foreground`); `/design` and guide entries.
- [ ] **Step 4: Run** `npx nx run-many -t test lint typecheck -p web`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): rating bar in the library`

### Task 5: Setup answers, mapping and the next-step rule (pure)

**Files:**

- Modify: `apps/web/package.json` (add `"zod": "^4.6.7"`).
- Create in `apps/web/src/lib/setup/`: `steps.ts`, `answers.ts`, `mapping.ts`, `options.ts`, `next-step.ts`.
- Test: `answers.spec.ts`, `mapping.spec.ts`, `options.spec.ts`, `next-step.spec.ts` next to them.

**Interfaces:**

- Produces:
  - `steps.ts`: `SETUP_STEPS = [{ id: 'about', label: 'About you' }, { id: 'eligibility', label: 'Where you can work' }, { id: 'job', label: 'The job you want' }, { id: 'terms', label: 'Location and terms' }, { id: 'resume', label: 'Resume' }] as const`; `type SetupStepId = 'about' | 'eligibility' | 'job' | 'terms' | 'resume'`; `stepPath(id: SetupStepId | 'review'): string` (`/setup/<id>`).
  - `answers.ts` (zod schemas and inferred types):
    - `AboutAnswers { name: string; phone: string | null; linkedin: string | null; links: { kind: 'github' | 'gitlab' | 'portfolio' | 'website' | 'other'; value: string }[] }`. Name trimmed, 1–200 chars; links must be `http(s)://` URLs; no duplicate (kind, value).
    - `EligibilityAnswers { residenceCountry: string; acceptsSponsorship: boolean; authorizations: { kind: AuthorizationKind; place: string }[]; noneConfirmed: boolean }`. Refine: empty `authorizations` needs `noneConfirmed`; no duplicate pairs.
    - `TechAnswer { code: string; rating: 1 | 2 | 3 | 4 | 5 | null; starred: boolean }`; `JobAnswers { position: string; yearsOfExperience: number; seniorities: string[]; techs: TechAnswer[]; languages: { lang: string; level: 'native' | 'fluent' | 'working' }[] }`. `jobSchema(isSearchable: (code) => boolean)` refines: years integer 0–60; ≥ 1 seniority; every tech rated (error path `techs.<i>.rating`, message "Rate <label>" filled by the form); ≥ 1 searchable tech ("Add at least one tech we can search for"); ≤ 2 starred, starred only if searchable; ≥ 1 language, unique langs.
    - `PlaceRow { place: Place; remote: boolean; hybrid: boolean; onsite: boolean }` with `Place` = `{kind:'worldwide'} | {kind:'region'|'country', code} | {kind:'city', id}`; `TermsAnswers { places: PlaceRow[]; timezoneCurrent; timezoneMin; timezoneMax; contractTypes: string[]; engagements: string[]; noticePeriodDays: number; salary: { min: number; currency: string; period: 'hour'|'day'|'month'|'year' } | null; acceptsAnyCurrency: boolean; acceptedCurrencies: string[] }`. Refines per Global Constraints (worldwide only remote, each row ≥ 1 arrangement, ≤ 20 per arrangement, no duplicates, `timezoneMin <= timezoneMax`, notice in options).
    - `SetupDraft { version: 1; job?: JobAnswers; terms?: TermsAnswers }`; `parseDraft(json: unknown): SetupDraft | null` (null on any mismatch, so an old draft restarts the step instead of crashing).
  - `mapping.ts`: `domainFor(position: string): SkillDomain`; `ratingToMastery(r)`, `masteryToRating(m)`; `toProfileWrite(job: JobAnswers, terms: TermsAnswers): { profile: ProfileWrite; skills: SkillWrite[] }` (`ProfileWrite` = the `p_profile` columns from Task 2, `locations` built as `{ remote, hybrid, onsite }`); `jobColumns(job)` and `termsColumns(terms)` (the halves, for updates); `fromProfile(row: ProfileRow, skills: SkillRow[]): { job: JobAnswers; terms: TermsAnswers }` (places merged back into rows by identity, one row per distinct place).
  - `options.ts`: `NOTICE_OPTIONS: { days: number; label: string }[]`, `nearestNotice(days): number` (ties to the shorter), `TIMEZONE_OFFSETS: number[]`, `formatOffset(min): string` ("UTC+5:30", "UTC−1", "UTC"), `timezonePrefill(browserOffset: number): { current; min; max }`.
  - `next-step.ts`: `SetupSnapshot { name: string | null; residenceCountry: string | null; acceptsSponsorship: boolean | null; draft: SetupDraft | null; profile: { id: string; hasResume: boolean } | null }`; `nextSetupStep(s): SetupStepId | 'done'` with the spec's six rules in order.

- [ ] **Step 1: Write the failing tests** (exact values from Global Constraints):
  - `mapping.spec.ts`: `domainFor` over every row of the table plus `embedded_engineer`→`backend` and `'brand_new_code'`→`backend`; `ratingToMastery(1..5) = [2,4,6,8,10]`; `masteryToRating(0)=1, (7)=4, (10)=5`; `toProfileWrite` gives `importance` 10 for starred and 5 otherwise and the position's domain on every skill; places `[Europe region remote, Berlin city hybrid+onsite]` → `locations = { remote: [region EU], hybrid: [city], onsite: [city] }`; `fromProfile` round-trips that answer, and maps mastery 7 / importance 8 / notice 45 to rating 4 / starred / 30.
  - `answers.spec.ts`: one test per refine above, each asserting the error path; `worldwide with hybrid is refused`; `empty authorizations without noneConfirmed is refused`; `three stars are refused`; `parseDraft({version: 2})` is null.
  - `options.spec.ts`: `timezonePrefill(60)` = `{current: 60, min: -120, max: 240}`; `timezonePrefill(780)` max clamped to 840; `formatOffset(330) === 'UTC+5:30'`; `nearestNotice(45) === 30`, `nearestNotice(21) === 14`, `nearestNotice(500) === 180`.
  - `next-step.spec.ts`: one case per rule, plus `profile with resume but null name → 'about'` (rules apply in order).
- [ ] **Step 2: Run** `npx nx test web -- lib/setup`. Expected: FAIL.
- [ ] **Step 3: Implement** the five files.
- [ ] **Step 4: Run** `npx nx run-many -t test lint typecheck -p web`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): setup answers, mapping and next-step rule`

### Task 6: Loading and saving setup data

**Files:**

- Create in `apps/web/src/lib/setup/`: `load.ts`, `value-lists.ts`, `save.ts`.
- Test: `load.spec.ts`, `save.spec.ts` (fake clients in the style of `src/lib/resume/delete-draft.spec.ts`).

**Interfaces:**

- Consumes: Task 2's table and functions, Task 5's types and mappers.
- Produces:
  - `loadSetupSnapshot(supabase): Promise<SetupSnapshot>`: own `users` row, own draft (`parseDraft`), oldest own profile (`order('createdAt')`, `hasResume = resumeKey !== null`). RLS scopes every read.
  - `loadSetupProfile(supabase, profileId): Promise<{ job; terms } | null>` via `fromProfile`.
  - `loadAbout(supabase): Promise<{ email: string; answers: AboutAnswers }>` (email from claims; contacts mapped back to phone, LinkedIn and links).
  - `loadEligibility(supabase): Promise<EligibilityAnswers | null>` (null until step 2 was saved, that is while `acceptsSponsorship` is null; `noneConfirmed` is `true` when it was saved with no authorizations).
  - `loadValueLists(supabase): Promise<ValueLists>` with `PickerOption[]` per list: `positions` (approved, `isEngineering`), `seniorities`, `contractTypes`, `engagements` (no `unstated`), `techs` (each with `searchable: isSearchableTech(code)`), `languages`, `currencies`, `countries`, `regions` (no `GLOBAL`), `cities` (label "name, country label", value the city id). Aliases go in `keywords`.
  - `type SaveResult = { status: 'saved' } | { status: 'invalid'; errors: Record<string, string> } | { status: 'failed' }`.
  - `saveAbout(supabase, userId, input: unknown)`: validate; update `users.name`; upsert contacts on `(userId, kind, value)`, then delete this user's `phone`/`linkedin`/link-kind rows not in the answer (insert before prune, so a failure never loses a contact). Leaves `email` contacts alone.
  - `saveEligibility(supabase, userId, input)`: validate; update `residenceCountry`, `acceptsSponsorship`; upsert then prune `work_authorizations`.
  - `saveJob(supabase, userId, input, isSearchable)`: validate; if a profile exists, update `jobColumns` and rpc `replace_profile_skills`; otherwise upsert the draft (`onConflict: 'userId'`) merging `job`.
  - `saveTerms(supabase, userId, input)`: validate; if a profile exists, update `termsColumns`; otherwise upsert the draft with `terms`, then if the draft has `job`, rpc `create_profile_from_setup(toProfileWrite(...))`. A `P0002` from the rpc means another request already created it: return `saved`. A check or trigger error returns `invalid` with the database message under `_form`.
  - Every function logs only error codes, never answers.

- [ ] **Step 1: Write the failing tests:** `loadEligibility returns noneConfirmed when saved with no authorizations`; `saveTerms creates the profile when the draft has job answers` (rpc called once with mapped payload); `saveTerms treats a missing draft as already created` (rpc `P0002` → `saved`); `saveTerms keeps the draft and returns invalid on a check error` (no delete call); `saveTerms updates the profile when it exists` (no rpc); `saveJob on an existing profile replaces skills with the new domain` (position `frontend_engineer` → every skill `frontend`); `saveJob without a profile writes only the draft`; `saveAbout upserts before it prunes and never touches email contacts`; `saveEligibility rejects empty authorizations without the tick`; `loadSetupSnapshot ignores an unparseable draft`.
- [ ] **Step 2: Run** `npx nx test web -- lib/setup`. Expected: FAIL.
- [ ] **Step 3: Implement** the three files.
- [ ] **Step 4: Run** `npx nx run-many -t test lint typecheck build -p web`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): load and save setup answers`. Hand PR 1 to the human to push.

## PR 2: The flow

### Task 7: Routes, guards and the step frame

**Files:**

- Create: `apps/web/src/app/(flow)/setup/guard.ts`, `apps/web/src/app/(flow)/setup/actions.ts`, `apps/web/src/components/setup/step-frame.tsx`, one `page.tsx` per step under `apps/web/src/app/(flow)/setup/{about,eligibility,job,terms,resume,review}/` (placeholders rendering `StepFrame` until Tasks 8–11).
- Modify: `apps/web/src/app/(flow)/setup/page.tsx` (redirect only), `apps/web/src/lib/auth/landing.ts` (and its spec: uses `loadSetupSnapshot` + `nextSetupStep`), `apps/web/src/app/(app)/layout.tsx` (async; redirect unfinished users to `/setup`), `apps/web/src/app/(app)/page.tsx` (drop its own landing check).
- Test: `apps/web/src/app/(flow)/setup/guard.spec.ts`, `apps/web/src/lib/auth/landing.spec.ts`, `apps/web/src/components/setup/step-frame.spec.tsx`

**Interfaces:**

- Produces:
  - `setupRedirect(step: SetupStepId | 'review' | 'index', next: SetupStepId | 'done'): string | null` (pure, tested): `index` → `/` when done, else `stepPath(next)`; a step after `next` (by `SETUP_STEPS` order, `review` last and open only when done) → `stepPath(next)`; else `null`.
  - `requireSetupStep(step): Promise<{ supabase; userId; snapshot }>`: claims (else `/sign-in`), snapshot, `redirect(setupRedirect(...))` when non-null.
  - Server actions in `actions.ts`: `saveAboutAction`, `saveEligibilityAction`, `saveJobAction`, `saveTermsAction`, each `(input: unknown) => Promise<SaveResult>` (resolve user from claims, else `failed`).
  - `StepFrame({ step: SetupStepId | 'review', title, lead?, children, onBack?: () => void, submitLabel = 'Continue', pending, formId })`: `Steps` (current index; review shows all done), `h1` `text-title-3`, lead in `text-muted-foreground`, a footer with `Button variant="ghost"` Back (hidden on step 1) and `Button` `loading={pending}` submit for `formId`. Save failures show `toast.error('Couldn't save. Try again.')`; `_form` errors render as `role="alert"` text above the footer.

- [ ] **Step 1: Write the failing tests:** `setupRedirect` table: (`index`, `'job'`) → `/setup/job`; (`index`, `done`) → `/`; (`resume`, `'eligibility'`) → `/setup/eligibility`; (`about`, `'terms'`) → null; (`review`, `'resume'`) → `/setup/resume`; (`job`, `done`) → null. `landingPath` returns `/setup` for a user with a profile but no resume. `StepFrame` hides Back on `about` and marks the current step `aria-current="step"`.
- [ ] **Step 2: Run** `npx nx test web -- setup landing`. Expected: FAIL.
- [ ] **Step 3: Implement** the files.
- [ ] **Step 4: Run** `npx nx run-many -t test lint typecheck build -p web`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): setup routes and guards`

### Task 8: Steps 1 and 2

**Files:**

- Create: `apps/web/src/components/setup/about-form.tsx`, `eligibility-form.tsx`, `authorization-rows.tsx`.
- Modify: `apps/web/src/app/(flow)/setup/about/page.tsx`, `eligibility/page.tsx`.
- Test: `about-form.spec.tsx`, `eligibility-form.spec.tsx`

**Interfaces:**

- Consumes: `StepFrame`, `saveAboutAction`, `saveEligibilityAction`, `ValueLists`.
- Produces (reused by slice 08): `AboutForm({ email, initial: AboutAnswers, onSave, onSaved })`, `EligibilityForm({ initial: EligibilityAnswers | null, lists, onSave, onSaved })`. Each step form renders a `<form id>` and is used inside `StepFrame`; `onSaved` navigates to the next step.

- [ ] **Step 1: Write the failing tests:** about: `continue with only a name saves`, `empty name shows "Enter your name"`, `invalid link shows its FieldError`, email shown read-only. Eligibility: `picking residence offers "Add residency in Morocco?" and clicking it adds the row`, `nothing is added without the click`, `continue with no rows and no tick shows the error`, `sponsorship starts unselected and is required`, `a duplicate kind+place row is refused`.
- [ ] **Step 2: Run** `npx nx test web -- components/setup`. Expected: FAIL.
- [ ] **Step 3: Implement** with `Field`, `Input`, `InputGroup`, `Picker`, `Select`, `Checkbox`, `RadioGroup`, `Button`. Pages load the snapshot, `users` contacts and lists, and pass `initial`.
- [ ] **Step 4: Run** the tests, lint, typecheck. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): setup steps 1 and 2`

### Task 9: Step 3

**Files:**

- Create: `apps/web/src/components/setup/job-form.tsx`, `tech-rows.tsx`, `language-rows.tsx`.
- Modify: `apps/web/src/app/(flow)/setup/job/page.tsx` (initial from the draft or `loadSetupProfile`).
- Test: `job-form.spec.tsx`, `tech-rows.spec.tsx`

**Interfaces:**

- Produces: `JobForm({ initial: JobAnswers | null, lists, onSave, onSaved })`; `TechRows({ value: TechAnswer[], onChange, options })`; `LanguageRows({ value, onChange, options })`.

- [ ] **Step 1: Write the failing tests:** `picking a tech adds an unrated row`; `continue with an unrated tech shows "Rate PostgreSQL"`; `a third star is disabled with the hint "Up to two techs can drive search"`; `the star is disabled on a non-searchable tech`; `only concept techs shows "Add at least one tech we can search for"`; `the stack description is the exact copy`; `a language appears once`; the lead copy is exact.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement**: position `Picker`, years `Input type="number"`, seniority `Checkbox`es, tech search with `Picker` (selected techs filtered out) feeding `TechRows` (row: label, `RatingBar` with the end labels, star `Toggle` with `aria-label="Search for <label>"` and `Tooltip` "Search for this", remove `Button variant="ghost" size="icon-sm"`), `LanguageRows` (row: label, level `Select`, remove).
- [ ] **Step 4: Run** the tests, lint, typecheck. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): setup step 3`

### Task 10: Step 4

**Files:**

- Create: `apps/web/src/components/setup/terms-form.tsx`, `place-rows.tsx`, `timezone-fields.tsx`, `salary-fields.tsx`.
- Modify: `apps/web/src/app/(flow)/setup/terms/page.tsx`.
- Test: `terms-form.spec.tsx`, `place-rows.spec.tsx`, `timezone-fields.spec.tsx`

**Interfaces:**

- Produces: `TermsForm({ initial: TermsAnswers | null, lists, onSave, onSaved })`, `PlaceRows({ value: PlaceRow[], onChange, options })`, `TimezoneFields({ value, onChange })`, `SalaryFields({ value, onChange, currencies })`.

- [ ] **Step 1: Write the failing tests:** `Worldwide is the first option and its row allows only Remote`; `a place under worldwide remote shows the hint and still saves`; `a row with no arrangement is refused`; `time zone fields prefill from the browser offset` (mock `getTimezoneOffset` to −60 → current UTC+1, from UTC−2 to UTC+4); `contract types start empty and "Select all" ticks all`; `salary stays collapsed and is omitted until opened`; `turning off "Any currency" needs one currency`; `a creation error from the server shows above the footer and keeps the answers`.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement**: place search `Picker` over worldwide + regions + countries + cities with kind labels (`Badge variant="secondary"` in the row), `PlaceRows` (row: kind badge, label, `ToggleGroup multiple`, remove); `TimezoneFields` with three `Select`s using `formatOffset`; contract types and engagements as `Checkbox` groups with a `Button variant="link"` "Select all" (engagement hints in `FieldDescription`, builder's wording); notice `Select`; salary behind `Button variant="dashed"` "Add a minimum salary" (`Input`, currency `Picker`, period `Select`); `Switch` "Any currency" + `MultiPicker`.
- [ ] **Step 4: Run** the tests, lint, typecheck. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): setup step 4`

### Task 11: Step 5 and the review

**Files:**

- Create: `apps/web/src/components/setup/resume-step.tsx`, `review.tsx`.
- Modify: `apps/web/src/app/(flow)/setup/resume/page.tsx`, `review/page.tsx`.
- Test: `resume-step.spec.tsx`, `review.spec.tsx`

**Interfaces:**

- Consumes: `uploadResume`, `confirmResumeAction`, `MAX_RESUME_BYTES` (`src/lib/resume`), `FileDropZone`.
- Produces: `ResumeStep({ profileId, userId, current: { filename: string; sizeBytes: number } | null, onSaved })`, `Review({ about: AboutAnswers; eligibility: EligibilityAnswers; job: JobAnswers; terms: TermsAnswers; resume: { filename: string; sizeBytes: number }; lists: ValueLists })`.

- [ ] **Step 1: Write the failing tests:** resume: `reject reasons map to messages` (`type` → "Upload a PDF", `size` → "PDFs up to 5 MB", `multiple` → "Upload one file"); `confirm result invalid not-pdf shows "This file isn't a PDF"`; `after upload the name and size show with Replace`; `Continue is disabled until a resume exists`. Review: `one card per step with an Edit link to its path`; `Finish links to /`.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** with `FileDropZone`, `Field`, `Card`, `Button`, `TextLink`. The review reads labels from `ValueLists` (codes never shown raw).
- [ ] **Step 4: Run** the tests, lint, typecheck. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): setup resume step and review`

### Task 12: Roadmap docs and the full check

**Files:**

- Modify: `docs/roadmap/phase-1-accounts-and-preferences/README.md` ("Open, to settle before slice 07": publishing settled, no publish button in Phase 1, link to the spec), `07-guided-setup-ui.md` (link to the spec), `08-edit-preferences-ui.md` (reuse the step forms in `src/components/setup`; the star and rating rules apply).

- [ ] **Step 1: Run the full CI set:** `npx nx run-many -t lint test build typecheck` and `pnpm db:test`. Expected: PASS.
- [ ] **Step 2: Walk the flow by hand** against the local stack (`pnpm db:start`, `npx nx dev web`, `pnpm users link <email>`): finish every step; quit at step 3 and at step 4, sign in again in another browser, land on the same step with answers kept; open `/setup/resume` early; check 360px wide in both themes. State the result in the PR description.
- [ ] **Step 3: Commit** `docs: guided setup settles publishing for Phase 1`. Hand PR 2 to the human to push.
