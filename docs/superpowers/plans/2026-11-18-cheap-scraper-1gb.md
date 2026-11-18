# cheap_scraper at 1 GB Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run cheap_scraper at 1024 MB so its Apify start fee drops from $0.02 to $0.005 per run.

**Architecture:** An optional `memoryMbytes` on `ActorRunConfig`, set only in `LinkedinJobBoardCheapCollector.config` and passed to `ApifyActorProvider.run`, whose `ApifyStartOptions.memoryMbytes` already maps to Apify's `memory`.

**Tech Stack:** NestJS, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-18-cheap-scraper-1gb-design.md`

## Global Constraints

- cheap_scraper runs at `memoryMbytes: 1024`.
- No other collector sends a memory size (harvestapi, LinkedIn posts, Greenhouse, Ashby unchanged).
- Schedule, window, searches and caps unchanged.

## Review Focus

- A config without `memoryMbytes` (every other collector) must not send `memoryMbytes: undefined` keys that change their `run` call options in their existing specs; this plan changes no other collector, so their specs must still pass untouched.

---

### Task 1: cheap_scraper run memory

**Files:**

- Modify: `apps/xjobs/src/modules/collectors/types/collector.ts` (`ActorRunConfig`)
- Modify: `apps/xjobs/src/modules/collectors/providers/linkedin-job-board-cheap.collector.ts`
- Test: `apps/xjobs/src/modules/collectors/providers/linkedin-job-board-cheap.collector.spec.ts`

**Interfaces:**

- Produces: `ActorRunConfig.memoryMbytes?: number` — the run's memory in MB; absent means the actor's default. Doc comment: Apify charges some actors' start fee per GB of memory.

- [ ] **Step 1: Update the failing tests**

In the spec:

- The config test (`expect(LinkedinJobBoardCheapCollector.config).toEqual({...})`) gains `memoryMbytes: 1024`.
- `runs one search for the segment with the resolved geoId`: `expect(options).toEqual({ maxChargeUsd: 0.15, memoryMbytes: 1024 })`.
- `raises the rows and the charge cap with the segment maxItems`: `expect(run.mock.calls[0]![2]).toEqual({ maxChargeUsd: 1.5, memoryMbytes: 1024 })`.
- The mock's `options?` type becomes `{ maxChargeUsd: number; memoryMbytes?: number }`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx nx test xjobs -- linkedin-job-board-cheap.collector`
Expected: the three assertions above FAIL (no `memoryMbytes`).

- [ ] **Step 3: Implement**

- Add `memoryMbytes?: number` to `ActorRunConfig` with the doc comment above.
- `LinkedinJobBoardCheapCollector.config` gains `memoryMbytes: 1024`, with a one-line comment: its start fee is $0.005 per GB, and its 4 GB default made every run cost $0.02 before any row.
- `collect` passes `{ maxChargeUsd, memoryMbytes: config.memoryMbytes }` to `this.actor.run`.

- [ ] **Step 4: Run the tests and checks**

Run: `npx nx test xjobs -- collectors` then `npx nx run-many -t lint typecheck -p xjobs`
Expected: PASS, no lint or type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/xjobs/src/modules/collectors docs/superpowers
git commit -m "fix(collectors): run cheap_scraper at 1 GB to cut its start fee"
```
