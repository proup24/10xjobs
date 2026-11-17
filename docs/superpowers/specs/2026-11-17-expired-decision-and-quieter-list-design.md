# Expired decision and a quieter match list

Small change. Two independent web-app tweaks shipped together.

## 1. Hide the Unverified badge on the match list

**Why:** most jobs are unverified, so the badge is on nearly every row and carries no signal.

- Remove the `Unverified` badge from `MatchRowLink` (`apps/web/src/components/matches/match-row.tsx`).
- Keep the `unverified` field on `MatchedJob` and its computation in `group.ts`; only the display goes. Update specs that assert the badge.
- Non-goal: changing the job detail or what "unverified" means.

## 2. An "Expired" decision next to Applied / Not for me

**Why:** a user opens a job and finds the listing expired or no longer accepting applications. Today the only way to clear it from Matches is "Not for me", which records a judgment about the match and pollutes the reason data used to find wrong rejections. "Expired" is a fact about the listing, not about fit.

**Anti-goals:** expired marks showing up in the Not-for-me / rejection analysis; one user's click changing the job for anyone else.

### Approaches

- **A. Third decision status `expired` (picked).** Per-user, like applied/dismissed. Keeps rejection data clean. Needs a schema change.
- B. "Not for me" with reason `expired`, one click. No schema change, but mixes dead listings into rejection data.
- C. Report the job as closed for everyone. Shared effect from one click; out of scope.

### Design

- **Schema:** `job_decisions.status` check becomes `IN ('applied','dismissed','expired')`. An expired decision is bare, like applied: no reason, note or match snapshot (the existing `job_decisions_applied_bare` check already requires that of any non-dismissed status, so it stays as is). New migration; advance the `app/refs/db.json` hash.
- **Save path:** `Decision` in `apps/web/src/lib/applications/decide.ts` accepts `{ jobId, status: 'expired' }`, stored bare like applied. RLS unchanged (insert still needs a current match).
- **Job detail:** a third button, **Expired**, after Applied and Not for me. One click, no dialog (same as Applied). The job leaves Matches and Review like any decided job.
- **Applications page:** a third tab, **Expired**, after Applied and Not for me, with its own empty text ("Jobs you mark expired show here") and URL status `?status=expired`. Rows offer the same moves the other tabs do: change to Applied / Not for me, and move back to Matches.
- **Engine merge precedence** (`jobs.writer.ts`, decisions copied across a merge): applied beats dismissed beats expired. Expired is the weakest since it says the least about the user's intent.
- **db:analyze:** counts only `dismissed`, so expired is excluded by construction; confirm no query counts "all decisions" as rejections.

### Left to the builder

- Button variant/order details within `DESIGN.md` (outline, like Not for me, is the default call).
- Exact empty-state and row label wording ("Expired · 2 days ago").
