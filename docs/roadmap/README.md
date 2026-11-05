# Roadmap

## Vision

10xjobs finds the right jobs, applies to them well, and tracks the whole pipeline. It exists because hunting by hand is slow and tools that automate it tend to spray generic applications.

## Deployment model

- **Hosted from the start:** one shared, multi-tenant deployment. Each user has their own account and can't see anyone else's data.
- The tenant is the user: a Supabase Auth account. There are no workspaces or teams. A user owns one or more job-search profiles.
- Every record a user owns carries their user id and is isolated by Postgres row-level security (RLS). Records only the engine uses (search queries, raw jobs) are shared across users and hidden from them.
- The code stays open source, so any engineer can also run their own copy.
- Anthropic and Apify run on the platform's own keys, shared by every user; users don't bring keys. Gmail access (Phase 3) is per user.
- Sign-up is invite-only for now.

## Anti-goals

Failure even if it technically works:

- Applying to the wrong jobs.
- Missing the right jobs: weak collection or over-eager rejection.
- Spamming recruiters or hiring-post authors with generic, low-quality applications or emails.

These rank above throughput: prefer precision over volume. The qualify step must be able to explain why a job was rejected.

## Phases

Each phase gets its own brainstorm, then spec, then plan, then PRs. The exit criteria define "done".

### Phase 0: Foundation

The shared Claude Code harness and the project docs. No product code.

### Phase 1: Accounts and preferences

Authentication, user accounts and a multi-tenant data model with per-user isolation, deployed as the shared hosted app. Each user creates job-search profiles holding the preferences the later phases act on, such as the jobs they want and their criteria for qualifying them. The Next.js web app enters the repo here.

**Exit criteria:** an invited user can sign up on the hosted app and can create and edit their profiles. One user can never read or change another user's data, and tests prove it.

**Slices:** [phase-1-accounts-and-preferences/](phase-1-accounts-and-preferences/README.md)

### Phase 2: Find

Collect jobs from LinkedIn (through Apify), Ashby and Greenhouse for each published profile. Normalize and deduplicate them, extract each job's facts, and qualify each job against the profile as qualified or rejected with a reason. The Anthropic API first enters the repo here.

Engine work for this phase (search query generation, collection, ingest) started in parallel with Phase 1 and is already on `main`.

**Exit criteria:** collection runs on a schedule without manual steps, duplicates across runs and sources are merged, and the web app shows new qualified jobs since the user last looked, from all three sources. Rejected jobs and their reasons can be viewed.

### Phase 3: Apply

- Tailor a personalized one-page resume per qualified job, and render it.
- Fill application forms from a personal fact bank.
- Email hiring-post authors from the user's Gmail.

How much a human reviews before anything is sent is decided in the Phase 3 spec. Default going in: nothing goes out without the user approving it.

### Phase 4: Track and report

Report what's new and how the pipeline is performing: volume and pass rates per stage and per source, plus application outcomes.
