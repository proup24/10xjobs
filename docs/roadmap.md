# Roadmap

## Vision

10xjobs finds the right jobs, applies to them well, and tracks the whole pipeline. It exists because hunting by hand is slow and tools that automate it tend to spray generic applications.

## Deployment model

- **Now:** self-hosted. Each engineer runs their own copy with their own keys (Anthropic, Apify, Supabase, later Gmail).
- **Later:** a shared, hosted, multi-tenant deployment where each user has a workspace.
- Every domain record belongs to a workspace from day one, so moving to multi-tenant is a deployment change, not a data-model rewrite.

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

### Phase 1: Find

Collect jobs from LinkedIn (through Apify), Ashby and Greenhouse. Normalize and deduplicate them, extract each job's facts, and qualify each job against the user's preferences as qualified or rejected with a reason. Next.js, Supabase and the Anthropic API first enter the repo here.

**Exit criteria:** collection runs on a schedule without manual steps, duplicates across runs and sources are merged, and the Next.js web app shows new qualified jobs since the user last looked, from all three sources. Rejected jobs and their reasons can be viewed.

### Phase 2: Apply

- Tailor a personalized one-page resume per qualified job, and render it.
- Fill application forms from a personal fact bank.
- Email hiring-post authors from the user's Gmail.

How much a human reviews before anything is sent is decided in the Phase 2 spec. Default going in: nothing goes out without the user approving it.

### Phase 3: Track and report

Report what's new and how the pipeline is performing: volume and pass rates per stage and per source, plus application outcomes.

### Phase 4: Hosted multi-tenant

Workspaces, authentication and a shared deployment. The ordering of this phase is tentative and not decided.
