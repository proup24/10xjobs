# 09: Non-remote jobs from remote searches

Found 2026-11-18 on `10xjobs-dev`. Investigation comes first, then a brainstorm and spec.

## Problem

The user saw non-remote jobs in the results, and some of them qualified. The profile wants remote jobs abroad, and hybrid or onsite only in Morocco.

## What dev shows (2026-11-16 12:00 to 2026-11-17 17:00 UTC)

### LinkedIn returns jobs it doesn't tag remote

What LinkedIn's own tag said on raw items from the remote searches (`workplaceType` in the harvestapi payload):

| Tag                               | Raw items |
| --------------------------------- | --------- |
| remote                            | 2,690     |
| none (`workRemoteAllowed: false`) | 538 (17%) |
| hybrid                            | 1         |
| onsite                            | 1         |

- 405 of the untagged rows are EY's bulk posting (ranks 26 to 461), 53 are adesso SE, and about 80 are scattered.
- 105 untagged rows came from the first 25 results, so it isn't only deep pages. It isn't the content source either.
- **Likely cause (lead):** curious_coder's input schema says LinkedIn now forces an AI job search that drops the workplace, experience and job-type filters and turns them into search terms (dated August 2026). Unconfirmed for harvestapi.
- **Decision:** don't drop untagged jobs. The processor judges them from the description _(user)_. After dedupe there were 87 such jobs: the processor read 40 as remote, 34 unstated, 9 hybrid and 3 onsite. 5 qualified.

### The description often disagrees with LinkedIn's tag

Of about 2,120 jobs from remote searches, the processor read 97 as hybrid, 34 as onsite and 482 as unstated.

### Seven hybrid or onsite jobs qualified

They passed in two ways:

- **Any option passes.** The location check takes the best of a job's openings.
  - CreateFuture (5 UK jobs, "hybrid/remote in Edinburgh, Leeds, Manchester, London, BG"): the remote UK option fits.
  - Torentify: onsite NYC, Boston, Austin or Reno fails, but "Remote positions are also available" has no place. That gives unknown, and unknown never rejects.
- **A place that's only mentioned.** Obie: "Our Chicago based employees are hybrid" became hybrid in Chicago with `placeStrictness: mention`. The location check returned unknown, so the job passed.

## Open questions

- Is "hybrid or remote" (CreateFuture) a job the user wants, or only jobs where remote is the main way of working?
- Should a remote opening with no stated place stay unknown when the job also names onsite cities?
- Should a mentioned-only place of the employees count as the job's place?
- Should the matcher use LinkedIn's tag at all when the description disagrees? Today the description wins (`facts/rules/combine.ts`).
- Confirm or rule out the AI-search lead with a few controlled harvestapi runs: the same search, with and without the workplace filter.
