# Guided setup

Phase 1, slice 07. Date: 2026-11-08.

Brief: [07-guided-setup-ui.md](../../roadmap/phase-1-accounts-and-preferences/07-guided-setup-ui.md). Builds on the [preferences and eligibility spec](2026-11-05-preferences-and-eligibility-design.md), [resume storage](2026-11-06-resume-storage-design.md) and [preferences switch and final names](2026-11-07-preferences-switch-and-remove-design.md) (PRs #24 and #25, merged). UI rules: [`apps/web/DESIGN.md`](../../../apps/web/DESIGN.md).

## Intent

An invited user signs in for the first time and, through a short guided setup, gives us everything we need to start finding them jobs: who they are, where they can legally work, the job they want, and their resume _(user's words: "after the guided setup is done, user should have entered all the details we need to start getting them jobs")_. When setup ends, nothing the engine needs to publish the profile is missing.

The UI must be consistent with the new design system, now and going forward _(user)_. Every screen is built only from `components/ui` and theme tokens; anything missing is added to the library first.

## Goals

- A five-step setup that ends with a user record, eligibility, one complete draft profile with its tech stack, and a resume.
- Answers are saved in the database after every step. A user who quits midway, on any device, comes back to the step they left _(user)_.
- Every value comes from a picker over the approved value lists; no free text for anything Phase 2 compares.
- Each step's form is a component that slice 08 (edit preferences) reuses.

## Non-goals

- Editing after setup, a second profile, deleting a profile (slice 08).
- Publishing. The roadmap's open item recommends no publish button until the engine deploys in Phase 2; setup ends with a **draft** profile _(user)_. No user gets jobs until a later slice adds publishing; that is accepted.
- Showing jobs (Phase 2).
- Postal address (`users.address`): optional and only for applications, so not in setup _(my call)_.
- Asking for skill domain (filled in, see Step 3). Importance is asked only as the "Search for this" star.

## Anti-goals

- A wrong answer that silently rejects good jobs: an accidental "no work authorization", a tech without a rating, a location list wider or narrower than the user meant.
- A half-finished profile visible to the engine or slice 08.
- One-off UI: a control built inside a page, a literal color, a raw `<input>`.

## Flow

Five steps in this order, then a review _(user's choice, option B of the grouping mockups)_. The `Steps` component shows progress; pages live under `src/app/(flow)/setup` inside `FlowLayout`.

| #   | Step               | Saves to                                                                    |
| --- | ------------------ | --------------------------------------------------------------------------- |
| 1   | About you          | `users.name`, `contacts`                                                    |
| 2   | Where you can work | `users.residenceCountry`, `users.acceptsSponsorship`, `work_authorizations` |
| 3   | The job you want   | the setup draft                                                             |
| 4   | Location and terms | the setup draft, then the profile is created from the draft                 |
| 5   | Resume             | slice 06's upload and confirm actions on the new profile                    |
| –   | Review             | nothing; a summary with Finish                                              |

Each step has Back and Continue. Continue validates the step, saves it, and moves on. Back never loses saved answers. A user can return to any finished step from the review's Edit links or Back; they can't jump ahead past an unfinished step _(my call)_.

### Step 1: About you

- **Name**: required.
- **Email**: the account email, shown read-only.
- **Contacts**: all optional _(user)_. A phone field, a LinkedIn field, and "Add a link" for GitHub, GitLab, portfolio, website or other (`ContactKind`). Each becomes a `contacts` row; editing replaces the user's rows for these kinds. `isPrimary` is left false _(my call)_.

### Step 2: Where you can work

- **Country of residence**: `Picker` over countries, required.
- **Work authorizations**: rows of a type `Select` (Citizenship, Residency, Work permit, Security clearance → `citizenship`, `residency`, `work-permit`, `clearance`) and a place `Picker` over countries and regions. "Add another" adds a row; duplicates are refused.
  - Once residence is picked, a one-click suggestion "Add residency in <country>?" appears. Nothing is added without the click, as the eligibility spec requires.
- **None is deliberate** _(my call)_: with an empty list, the user must tick "I don't hold any work authorization" to continue. The tick isn't stored; an empty list is the stored answer.
- **Sponsorship**: `RadioGroup` yes/no, "Would you take a job that sponsors your visa?", nothing preselected, required.

### Step 3: The job you want

- **Position**: `Picker` over approved engineering role kinds (`isEngineering`), required.
- **Years of experience**: number `Input`, 0–60, required.
- **Seniority**: `Checkbox` group over seniorities (not `unstated`), at least one.
- **Tech stack** _(user: technology and mastery only; scale 1–5; layout A)_:
  - A `MultiPicker`-style search over approved tech tags adds a row per tech. Each row has a 1–5 rating bar and a remove button. The ends are labelled "1 = learning · 5 = expert" _(my call)_.
  - Every tech needs a rating; the error names the tech that lacks one.
  - **"Search for this" star** _(user, from the builder check)_: each row has a star toggle; at most two techs can be starred (a third star is disabled with a hint). The engine searches only its top 2 techs by importance, then mastery, then name, so without this, equal ratings would be broken by alphabet. Only a tech with search wording can be starred.
  - **List every tech they'd accept** _(user)_: the stack is a ceiling in Phase 2, so the field's description reads "Add every tech you'd be happy to work with; jobs that need something not on this list are skipped." No minimum count and no suggested techs.
  - At least one tech must have search wording (`TECHNOLOGY_TERMS`), since publishing needs a searchable tech. Concept tags (`saas`) may be added but can't be the only ones. The web app needs that list of searchable codes; how it gets it (a shared export from the engine's map, or a column on `tech_tags`) is the builder's call, as long as there is one source.
  - Stored _(my calls)_: `mastery` = rating × 2 (1→2 … 5→10) in the existing 0–10 column; `importance` = 10 for a starred tech and 5 otherwise (with no star, rating decides, as today); `domain` from the position (table below); one row per tech. No schema change. If the position changes, every row's domain follows.
- **Languages**: same row layout as the tech stack; a search over `iso_languages` adds a row with a level `Select` (Native, Fluent, Working). At least one; one row per language.

Position → domain _(my call)_:

| Position                                                       | Domain      |
| -------------------------------------------------------------- | ----------- |
| backend_engineer                                               | `backend`   |
| frontend_engineer                                              | `frontend`  |
| fullstack_engineer                                             | `fullstack` |
| mobile_engineer                                                | `mobile`    |
| devops, site_reliability, platform, cloud engineer             | `devops`    |
| data_engineer                                                  | `data`      |
| ml_engineer, ai_engineer                                       | `ml`        |
| security_engineer                                              | `security`  |
| qa_engineer                                                    | `qa`        |
| anything else (embedded, architect, tech lead, EM, a new code) | `backend`   |

The domain only labels and groups searches; it doesn't change search text.

### Step 4: Location and terms

- **Locations** _(user: layout B)_: one place search over worldwide, regions, countries and cities, each result labelled with its kind. Each picked place is a row with three multi-select toggles, Remote, Hybrid, On-site, and a remove button. A row needs at least one toggle; at least one row overall.
  - **Worldwide** is offered first and allows only Remote _(my call; the database allows it anywhere)_.
  - A place already covered by worldwide remote shows a hint, not an error _(my call)_.
  - Stored as `{ remote, hybrid, onsite }`, each a list of `Place`s. The existing limits apply (20 per list, no duplicates). `GLOBAL` is never offered; worldwide is the `worldwide` kind.
  - City labels are "name, country label".
- **Time zone** _(user: agreed)_: their own UTC offset, prefilled from the browser and editable, and a range as two `Select`s ("from UTC−1 to UTC+4"), prefilled at their offset ±3 hours. Whole and the real half/quarter-hour offsets are listed; stored in minutes. Daylight saving time is ignored, as the engine does.
- **Contract types**: `Checkbox` group (not `unstated`), nothing preselected, at least one, with "Select all".
- **Hired as** (engagements): `Checkbox` group (not `unstated`) with a one-line hint each, nothing preselected, at least one, with "Select all".
- **Notice period** _(my call)_: `Select` of Immediately, 1 week, 2 weeks, 1 month, 2 months, 3 months, 6 months, stored as 0, 7, 14, 30, 60, 90, 180 days.
- **Minimum salary**: optional, collapsed under "Add a minimum salary". Amount `Input`, currency `Picker` over `iso_currencies`, period `Select` (hour, day, month, year). All three or none.
- **Accepted currencies**: `Switch` "Any currency", on by default; off shows a `MultiPicker` that needs at least one currency.

Continue on step 4 saves the draft and then creates the profile (see "Saving").

### Step 5: Resume

`FileDropZone` with `{ mime: 'application/pdf', extension: '.pdf' }` and `MAX_RESUME_BYTES`, using `uploadResume` and `confirmResumeAction` from `src/lib/resume`. Required: the brief's goal includes a resume. After upload the file name and size show with Replace. Reject reasons (`type`, `size`, `multiple`) map to messages.

### Review

One `Card` per step summarising its answers, each with an Edit link to that step. **Finish** goes to `/`. Setup is already complete at this point (see "When setup is done"), so Finish only confirms; a user who leaves on the review lands on `/` next time.

## Saving

Saving happens on every Continue, in the database, as the signed-in user through `supabase-js` and RLS _(user)_.

- **Steps 1 and 2** write the user's own rows directly (`users` update, `contacts` and `work_authorizations` replace).
- **Steps 3 and 4** write a **setup draft** _(user's choice, option 1)_: a new user-owned table, one row per user, holding the answers of steps 3 and 4 as they were entered (including the tech ratings and place rows). It exists so the strict profile columns from PR C stay required and nothing else ever sees an incomplete profile.
- **Creating the profile**: on step 4's Continue, a database function (security invoker, so RLS still applies) reads the draft, inserts the profile and its `profile_skills` rows, and deletes the draft, in one transaction, returning the profile id. If any check fails, nothing is written and the error names the field.
- **After the profile exists**, going back to steps 3 or 4 edits the draft profile directly (users may update drafts), using the same form components slice 08 will use. No draft row is created again.

The draft table _(builder details left open)_: `userId` as its key and owner column, `@@rls` with owner policies (`"userId" = auth.uid()`), `Timestamps`. Its payload shape is the web app's (a versioned JSON the web validates); the database doesn't check codes in the draft, because the profile's own checks run when the function creates the profile. It is added to the two-user isolation harness, and the RLS-enabled check covers it. It lives in `contract.prisma` like every table; the function goes in a hand-written migration.

## When setup is done

Derived from saved data, no flag _(my call)_. A user's next step is the first that holds:

1. `users.name` is null → step 1.
2. `residenceCountry` or `acceptsSponsorship` is null → step 2.
3. No profile, and no step-3 answers in the draft → step 3.
4. No profile → step 4.
5. The profile has no resume → step 5.
6. Otherwise setup is done.

`landingPath` in `src/lib/auth/landing.ts` switches from "any profile" to this rule. Signed-in pages outside setup send an unfinished user to `/setup`, which opens their next step. A finished user who opens `/setup` goes to `/` _(my call)_.

## Components

Built only from `components/ui` and tokens (`DESIGN.md`). New library components, each added to `components/ui`, the `/design` page and `DESIGN.md` before a setup page uses it:

- **Rating bar**: five buttons 1–5 as one radio-style group, field focus recipe, labelled ends. Usable later for other ratings.
- **Place row toggles**: three multi-select toggles (Remote, Hybrid, On-site), with a disabled state for worldwide's hybrid and on-site.

The tech row, language row, place row, authorization row and the step forms are feature components (under `src/components/setup` or similar, builder's call) composed from the library. Each step form takes its values and an onSave, so slice 08 can mount it outside the flow.

- **Star toggle**: a pressed/unpressed icon toggle (`aria-pressed`, clickable focus recipe), with a disabled state. shadcn's `toggle` restyled onto roles is the likely base.

Copy _(my wording)_: step 3's lead text is "We only show you jobs that match every answer here." The tech stack's description is the user-approved line above. "Be as strict as you mean it" is dropped, because it pushes users to list too few techs.

## Responsive and accessibility

Desktop-first, then checked at 360px wide with nothing scrolling sideways (`DESIGN.md`). `Steps` already collapses to "Step N of M" below `sm`. Rows (tech, language, place, authorization) stack their controls below `sm`. Every control sits in a `Field`; required fields pass `required`; errors use `FieldError`; save failures use a toast.

## Testing

- Unit tests (web): position → domain, rating ↔ mastery, star ↔ importance and the two-star limit, notice options ↔ days, time zone prefill, the next-step rule, the draft-to-profile mapping, each new library component (including the a11y recipe check).
- db-tests: the draft table's isolation (two users), the create-profile function (creates profile and skills, deletes the draft, refuses an invalid draft without writing anything, can't act on another user's draft).
- An end-to-end walk through setup is the builder's call if a browser test runner exists by then; otherwise a manual run against the local stack is stated in the PR.

## Mockups

Seen during the brainstorm (not committed; kept in `.superpowers/brainstorm/`): step grouping (B chosen), tech stack rating (A chosen), locations (B chosen). The sample screen for step 3 used the dark theme tokens.

## Decided after the builder check

- **Publishing**: off in this slice; setup ends with a draft _(user)_. The roadmap's open item is settled this way and its README should say so in the first PR.
- **Search choice**: the "Search for this" star, at most two _(user)_.
- **Stack copy**: ask for every acceptable tech _(user)_.

## Left to the builder

- Route layout under `(flow)/setup` (one route per step or one route with a step param), server actions vs. client writes per step, how pickers load and cache value lists.
- The draft payload's exact shape and version field, and the function's name and error format.
- How the web app knows which techs are searchable (one source shared with the engine).
- The PR split.
