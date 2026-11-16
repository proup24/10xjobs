# Duplicate tech requirements

Date: 2026-11-16
Status: draft
Builds on: [listing facts](2026-11-12-listing-facts-design.md), [models on Claude](2026-11-13-claude-models-design.md)

## Problem

On 2026-11-16, the first live weekday of slice 04, 12 of 1,187 new jobs failed processing. 11 of them failed on the same check:

```
techStack.value.requirements.2.technology: "dotnet" with domain backend appears twice
```

Examples are "Senior Full Stack .NET Developer", "AWS Cloud Engineer", "Wordpress Developer" and "Front End Engineer II". These are engineering jobs we want, so losing them breaks the anti-goal of missing the right jobs.

### What happens

1. The model reads a posting and lists each technology it asks for, such as `{ text: "ASP.NET", domain: "backend", kind: "must" }`.
2. After the model answers, the engine maps each text to a code from our vocabulary. Aliases collapse at this step. In the dev vocabulary, ".NET Core" and "ASP.NET" both become `dotnet`, "CSS" and "SCSS" both become `css`, "Three.js" and "WebGL" both become `threejs`, "AWS" and "Fargate" both become `aws`, and "REST APIs" and "OpenAPI" both become `rest`. These are the five codes in today's errors.
3. A rule (`rules/stack.ts`) then rejects the whole answer if one code appears twice with the same domain.
4. The engine sends that error back to the model and asks again, up to 3 tries in total. The model sees `"dotnet" appears twice`, but it may never have written "dotnet". It wrote two different words. So it repeats the same answer, and all 3 tries fail.
5. This error counts as permanent (`failure-policy.ts`), so the job is marked `failed` and never retried.

Each failed job cost three full model calls and produced nothing.

The attempts table doesn't keep the model's raw output, so we can't see which texts each job wrote. Two shapes are possible, and both end in the error above:

- **Same place twice:** two standalone requirements, or two members of the same "A or B" group, resolve to one code.
- **Two places:** the technology is listed once on its own and once inside a group ("AWS required" and "AWS or GCP").

## Goal

The engine fixes duplicates itself when the meaning is clear, instead of failing the job. When it can't tell what the posting meant, the model gets an error it can act on.

## Non-goals

- Reprocessing the 12 jobs that already failed _(user)_.
- Changing the prompt, the schema or the vocabulary.
- Changing the other stack rules (importance bands, group size, same kind within a group).

## Design

### 1. Merge clear duplicates

Add a pure function `mergeDuplicateRequirements(stack)` in `apps/xjobs/src/modules/processor/rules/stack.ts`. `FactAssembler.assemble` calls it after `resolveTerms` and before `checkStack`, because the codes exist only after resolution.

Two requirements are duplicates when they have the same resolved code, or the same trimmed lower-case text when the code is null, and the same `domain`. The `stackIssues` duplicate check already uses this key.

- **Both standalone** (`group: null`): keep one requirement whole and drop the other. The kept one has the stronger kind (`main` > `must` > `nice`), then the higher importance, then comes first. Keeping it whole means its quote, importance band and confidence still agree with each other.
- **Both in the same group:** drop the later one. If the group then has one member, remove the group and make that member standalone, since "X or X" means X. If the group's `min` is now above its member count, lower `min` to the member count.
- **In two places** (one standalone and one grouped, or in two different groups): don't merge. Dropping either copy changes what the posting asks for. For example, removing AWS from "AWS or GCP" would leave GCP looking required. These cases go to step 2.

The merge never adds or edits a requirement except to drop it, and it never touches group `min` except as described above.

### 2. A retry error the model can act on

For the duplicates step 1 leaves alone, the error names both texts the model wrote and where they are. For example:

```
techStack.value.requirements.4.technology: "AWS" (requirements.1, on its own) and "Amazon Web Services" (requirements.4, group g1) are the same technology (aws) in domain devops; list it once
```

The error text is also saved in `processing_attempts.error` and `normalized_jobs.processingError`, so the next investigation can see which shape happened. Today we can't.

### 3. Logging

When step 1 drops requirements, the attempt log writes one debug line, `merged N duplicate requirements (code, …)`, next to the existing "document assembled" line. Nothing is stored in the database.

### Where the duplicate check stays

`stackIssues` keeps its duplicate rule. `facts/schema/facts.ts` and the older extraction schemas use it as the final guard on stored documents, so a document with duplicates still can't be saved.

## Rollout

- No migration, no schema or prompt version bump, and no reprocess _(user)_. New jobs get the fix once the engine deploys.
- After a week on dev, check `processing_attempts` for errors containing `appears twice` or `same technology`. Expect close to zero failed jobs. If two-place duplicates still fail often, decide then whether to merge them too.

## Testing

Unit tests for `mergeDuplicateRequirements`:

- Two standalone duplicates: the stronger kind is kept, then the higher importance, then the first.
- Same-group duplicates: one is dropped; a group left with one member is dissolved; `min` is lowered when needed.
- One-standalone-one-grouped and two-group duplicates: unchanged.
- Same code with different domains: unchanged (still allowed).
- Null-code duplicates matched by text.
- No duplicates: returns an equal stack.

Assembler tests:

- An output with ".NET Core" and "ASP.NET" (both aliases of `dotnet`, same domain) assembles with one `dotnet` requirement.
- A two-place duplicate throws `ExtractionInvalidError` with the new message.

The golden eval (`processor:eval`) runs unchanged and must not get worse.
