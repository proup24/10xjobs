# 10xjobs — Project Foundation Design

Date: 2026-10-29
Status: draft, awaiting approval

## Intent

10xjobs is an open-source job-search automation workspace for software engineers. It **finds** jobs, **applies** to them with care, and **tracks** the whole pipeline. It exists because hunting by hand is slow and the tools that automate it tend to spray generic applications. 10xjobs aims to find the *right* jobs and apply to them *well*.

The first users are the two people building it. It is built in the open so any engineer can run it.

This document covers two things: the product's purpose and roadmap, and the Claude Code development harness the two maintainers will share. It does not design any product feature in detail. Each roadmap phase gets its own spec later.

## Product shape

- **Engine:** Node.js (NestJS, in the existing Nx monorepo). It does the collecting, filtering, qualifying, applying and tracking.
- **Web app:** Next.js. This is where the user manages everything: reviews jobs, sets preferences, and later approves applications and reads reports.
- **Claude:** called through the Anthropic API for specific tasks, such as pulling facts out of a posting or tailoring a resume. Claude is a component the engine calls. It does not orchestrate the engine.
- **Database:** Supabase (Postgres), added when the first feature needs persistence.
- **LinkedIn data:** fetched through Apify, never by scraping with the user's own LinkedIn session. Ashby and Greenhouse are read from their public job-board APIs.

### Deployment model

- **Now:** self-hosted. Each engineer runs their own copy with their own keys (Anthropic, Apify, Supabase, later Gmail).
- **Later:** a shared, hosted, multi-tenant deployment where each user has a **workspace**.
- **Decision (my call):** every domain record belongs to a workspace from day one, even while a self-hosted install has exactly one. Moving to multi-tenant should be a deployment change, not a data-model rewrite.

## Goals, non-goals, anti-goals

**Goals**
- Surface new, genuinely qualified jobs from LinkedIn (including "we're hiring" posts), Ashby and Greenhouse in one place.
- Apply to qualified jobs with a tailored, one-page resume and accurate form answers.
- Make the pipeline observable: what's new, and how well each stage is working.

**Non-goals (for now)**
- A hosted multi-tenant service. It comes later, and the data model only has to *allow* it.
- Sources beyond LinkedIn, Ashby and Greenhouse in the first phase. Others come later behind the same source abstraction.

**Anti-goals: failure even if it technically works**
- Applying to the wrong jobs.
- Missing the right jobs: weak collection or over-eager rejection.
- Spamming recruiters or hiring-post authors with generic, low-quality applications or emails.

These anti-goals rank above throughput. When there's a choice, prefer precision over volume and a tailored application over a fast one. The qualify step must be able to explain *why* a job was rejected, so wrong rejections can be found and fixed (my call, following from the "missing the right jobs" anti-goal).

## Roadmap

Each phase gets its own brainstorm, then spec, then plan, then PRs. The exit criteria below are what "done" means for that phase.

### Phase 0: Foundation (this session)
The shared Claude Code harness and the project docs described under "This session's deliverables". No product code.

### Phase 1: Find
Collect jobs from LinkedIn (through Apify), Ashby and Greenhouse. Normalize and deduplicate them, extract each job's facts, and qualify each job against the user's preferences as **qualified** or **rejected** with a reason.

**Exit criteria:** collection runs on a schedule without manual steps, duplicates across runs and sources are merged, and the Next.js web app shows *new qualified jobs since the user last looked*, from all three sources. Rejected jobs and their reasons can be viewed.

Phase 1 is therefore also where Next.js, Supabase and the Anthropic API first enter the repo.

### Phase 2: Apply
- Tailor a personalized one-page resume per qualified job, and render it.
- Fill application forms from a personal **fact bank**.
- Email hiring-post authors from the user's Gmail.

Guided by the anti-goals. How much a human reviews before anything is sent gets decided in the Phase 2 spec. My default going in: nothing goes out without the user approving it.

### Phase 3: Track and report
Report what's new and how the pipeline is performing: volume and pass rates per stage and per source, plus application outcomes.

### Phase 4: Hosted multi-tenant
Workspaces, authentication and a shared deployment. My guess at the ordering, not decided.

## Development harness (shared Claude Code setup)

Two maintainers, both developing in Claude Code. Everything below is committed to the repo so both get the same behavior. Personal overrides go in `.claude/settings.local.json`, which is already gitignored.

### Team workflow
For any non-trivial change: **brainstorm, then spec, then plan, then PR**, using the superpowers skills.
- Specs: `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`
- Plans: `docs/superpowers/plans/` (the writing-plans skill's default location)
- Both are committed. Work happens on branches and lands on `main` through PRs. CI (`lint test build typecheck`) must pass.
- No Linear or other ticket tracker is part of the team workflow. `CLAUDE.md` says so explicitly, so this overrides any personal instruction to offer or sync Linear tickets (decided).

### `CLAUDE.md` (repo root)
Short and factual. It contains:
- What 10xjobs is (one paragraph), the anti-goals, and the precision-over-volume principle.
- Stack and layout: Nx 24 monorepo, NestJS engine in `apps/xjobs`, e2e tests in `apps/xjobs-e2e`, and where Next.js and Supabase will go once added.
- Commands: `npx nx serve xjobs`, `npx nx run-many -t lint test build typecheck`, single-project variants, e2e.
- Conventions: TypeScript strict with nodenext; Vitest for tests; every domain record is workspace-scoped; Claude is called through the API from the engine; LinkedIn only through Apify.
- The team workflow above.
- Personal data rule: real resumes, fact banks and credentials never go in git (see below).
- A pointer to the roadmap doc.

### `.claude/settings.json`
- **Allowed without prompting:** `npx nx` lint, test, typecheck, build (tests in run mode, not watch), plus read-only git commands.
- **Always asks:** `git push`. Rules for Supabase writes (the `supabase` CLI's mutating commands, Supabase MCP write tools) are added in Phase 1, when Supabase enters the repo (my call).
- **Denied reads:** `.env*` files (except `.env.example`) and the personal-data folder.
- **Hook:** after Claude edits or writes a file, run Prettier on that file. Prettier is already configured with `.prettierrc` and `.prettierignore`.

**Enforcement (decided):** the guardrails must hold even in bypass-permissions mode, which the maintainers use. Permission rules alone are not enough. They only cover the Read tool, and an "ask" rule may not prompt in bypass mode. So a committed PreToolUse hook script (in `.claude/hooks/`) also:
- blocks Bash commands that touch `.env*` (other than `.env.example`) or `private/`, and Read/Edit/Write/Grep/Glob calls aimed at them;
- blocks `git push` from Claude's Bash tool outright, with a message telling the human to push it themselves. Blocking is used instead of prompting because it holds in every mode (my call).

The hook comes with a small set of test cases (sample tool inputs, expected allow or block) that can be run locally.

### Personal data and secrets
- **Decision (my call):** personal data lives in a gitignored `private/` folder at the repo root, e.g. resumes and the fact bank. Claude's settings deny reading it.
- `.env*` files are gitignored (except an `.env.example` with placeholder keys, added when the first key is needed) and unreadable to Claude.

## This session's deliverables

1. This design doc, committed.
2. `docs/roadmap.md`: the vision, anti-goals and phases with exit criteria, condensed from this doc so it stays the living reference after this spec is done.
3. `CLAUDE.md` as described above.
4. `.claude/settings.json` with the permissions and Prettier hook above.
5. `.gitignore` additions: `private/`, `.env*` (keeping `!.env.example`).
6. The existing uncommitted `nx.json` change (`nxCloudId` from `nx connect`) committed as its own commit, after running Prettier on the file so its formatting matches the repo style (my call; the cloud id is not a secret).
7. README: replace the Nx boilerplate with a short project intro that points to the roadmap (my call).
8. `.claude/hooks/` guard script and its test cases, as described under Enforcement.

**Delivery (decided):** all of this goes on a branch, not `main`, and lands through a PR that the other maintainer reviews. CI must pass. Because Claude can't push, the human pushes the branch and opens the PR (or approves Claude running `gh pr create` after pushing).

**Not in this session:** product code, Next.js scaffolding, Supabase setup, `npm install` of new dependencies.

## Left to the builder
- Exact wording and length of `CLAUDE.md` and the roadmap, as long as they're kept short.
- Exact permission patterns and hook script form, as long as the behavior matches above.
- How to verify the hook and permissions work (e.g. edit a file and confirm Prettier ran).
