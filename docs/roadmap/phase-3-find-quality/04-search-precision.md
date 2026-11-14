# 04: Search precision

Spec: [Search precision](../../superpowers/specs/2026-11-14-search-precision-design.md). Plan: [Search precision](../../superpowers/plans/2026-11-14-search-precision.md).

## Problem

Most of what LinkedIn searches return isn't the role anyone wants, and every one of those jobs is paid for twice: once to collect, and once, eight times over, to process.

- **31 of the first 60 processed jobs aren't software engineering roles.** 29 have role kind `other`.
- **52 of 60 failed the position check.**
- **The cost is in processing.** A job costs about $0.001 to collect and about $0.0084 to process, so about half of the processor spend went on jobs no profile could match.
- **Keywords are loose by design.** A builder's keyword is its technologies in plain words, for example `nestjs` or `next js`, with no quotes or operators. LinkedIn matches them anywhere in the posting, so a sales job that mentions React comes back.
- **harvestapi offers filters we don't use yet:**
  - `functionIds` (for example `eng`, `it`);
  - `industryIds`;
  - boolean operators in `jobTitles`.
- **Job functions are unreliable on their own.** In the live run, a backend engineering intern was tagged `ACCT, FIN`.
- **The shared-searches spec has to be revised against harvestapi.** Its planner OR's keywords together and merges work types and experience levels, and that also changes what each search returns.

## Open questions

- What would `functionIds: ['eng', 'it']` remove: how many real engineering jobs would it lose (recall) against the noise it cuts?
- Should keywords carry a role word (`engineer OR developer`) alongside the technologies, or should the technologies be OR'd, as the shared-searches spec planned?
- Is a cheap deterministic gate before the processor worth it? For example, skip a job whose title has no engineering word and whose job functions have no `ENG` or `IT`, and record why it was skipped. The anti-goal is missing the right jobs, so any gate needs measured recall.
- Does this slice also carry the shared-searches revision, or does that stay a Phase 2 item that this slice depends on?

## Suggested path

1. After 01 ships, label a week of collected jobs (engineering or not, from the processor's output) against their titles, job functions and the search that found them.
2. From that, measure what `functionIds`, a role word in the keyword, and a title gate would each cut, and what each would lose.
3. Pick the changes that cut noise without losing engineering jobs. Apply them in the builders or the shared-searches planner.
4. If a pre-processor gate is used, store its reason on the job, like any rejection, so wrong skips can be found.
