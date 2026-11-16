# Duplicate tech requirements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop failing jobs whose tech stack names one technology twice after alias resolution. The engine merges clear duplicates itself, and the model gets an error it can act on for the rest.

**Architecture:** A new pure function `mergeDuplicateRequirements` in `processor/rules/stack.ts` runs in `FactAssembler.assemble` between `resolveTerms` and `checkStack`. The duplicate message in `stackIssues` names both texts the model wrote. `AssembledDocument` carries what was merged, and `GenerationService` logs it. No database, schema, prompt or version change.

**Tech Stack:** NestJS engine (`apps/xjobs`), TypeScript strict, Zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-16-duplicate-requirements-design.md`

## Linear ticket

None. This project uses no ticket tracker.

## Global Constraints

- Duplicate key, unchanged from today: `technology.code ?? 'text:' + technology.text.trim().toLowerCase()`, plus `'|' + (domain ?? '')`.
- The kept copy is the one with the stronger kind (`main` > `must` > `nice`), then the higher importance, then the earlier one. It is kept whole: no field is copied from the dropped copy.
- Surviving requirements keep their original relative order.
- Never merge a technology listed in two places (one standalone and one grouped, or in two different groups).
- The input stack is never mutated.
- `stackIssues` keeps its duplicate rule as the final guard.
- No migration, no `EXTRACTION_SCHEMA_VERSION` bump, no prompt change, no reprocess.

## Review Focus

1. **Three copies of one technology, two standalone and one in a group.** The two standalone copies merge, and the remaining standalone-plus-grouped pair still fails with the new message. (Task 1 and Task 3 tests.)
2. **A group dissolved by a merge.** It must disappear from `groups` and its last member must get `group: null`. Otherwise `stackIssues` fails with "needs at least 2 members". (Task 1 test.)
3. **A group whose `min` equals its member count** ("all three of A, B, B"). After the merge, `min` drops to 2 and the stack passes `stackIssues`. (Task 1 test.)
4. **Null-code terms differing only by case or spaces** (`" Foo "` and `"foo"`) are duplicates. The same text in different domains is not. (Task 1 test.)
5. **The merged document still passes the final shape check** (`validDocument`) and the facts schema. Covered by the pipeline test in Task 3, which runs the real assembler.

---

### Task 1: `mergeDuplicateRequirements`

**Files:**

- Modify: `apps/xjobs/src/modules/processor/rules/stack.ts`
- Test: `apps/xjobs/src/modules/processor/rules/stack.spec.ts`

**Interfaces:**

- Produces:

  ```ts
  export interface MergedStack {
    stack: TechStack;
    /** One entry per dropped copy: its key's technology, code or `text:<text>`. */
    dropped: string[];
  }
  export function mergeDuplicateRequirements(stack: TechStack): MergedStack;
  ```

  Move the key computation into a module-private `requirementKey(r: Requirement): string` and use it in both functions.

- [ ] **Step 1: Write the failing tests** in `stack.spec.ts` under `describe('mergeDuplicateRequirements')`, reusing the file's `req` and `stack` helpers. After every merge, also assert `stackErrors(result.stack)` is `[]`, except in the "unchanged" cases.
  - `keeps the stronger kind of two standalone copies`: `req('dotnet', { kind: 'nice', importance: 3, domain: 'backend' })` and `req('dotnet', { kind: 'must', importance: 6, domain: 'backend' })` give one requirement with `kind: 'must'`, and `dropped` equals `['dotnet']`.
  - `keeps the higher importance on equal kinds`: must 5 and must 8 give importance 8.
  - `keeps the first on a full tie`: two identical `must 6` copies with quotes `'a'` and `'b'` give quote `'a'`.
  - `keeps three standalone copies as one`: three `css` copies give one, and `dropped` has length 2.
  - `drops the later copy inside one group and keeps the group`: `python`, `go` and `go` all in `g1` with `min: 1` give two members, with `groups` unchanged.
  - `dissolves a group left with one member`: `aws` and `aws` in `g1` with `min: 1` give `groups: []` and one requirement with `group: null`.
  - `lowers a group min above its member count`: `a`, `b` and `b` in `g1` with `min: 3` give `min: 2`.
  - `leaves a standalone and a grouped copy alone`: standalone `aws` plus `aws` and `gcp` in `g1`. The result deep-equals the input, and `dropped` is `[]`.
  - `leaves copies in two different groups alone`: same expectation.
  - `merges standalone copies but leaves the grouped one`: two standalone `aws` plus `aws` and `gcp` in `g1` give one standalone `aws` and the group. `stackErrors` still reports one duplicate.
  - `keeps the same code in different domains`: unchanged.
  - `matches null-code terms by trimmed lower-case text`: `{ text: ' Foo ', code: null }` and `{ text: 'foo', code: null }` merge, and `dropped` equals `['text:foo']`.
  - `does not mutate its input`: compare against a `structuredClone` taken before the call.

- [ ] **Step 2:** Run `npx nx test xjobs -- rules/stack`. Expected: FAIL, `mergeDuplicateRequirements` is not exported.

- [ ] **Step 3: Implement `mergeDuplicateRequirements`** in `stack.ts`. Approach:
  1. Clone the stack.
  2. Bucket requirement indices by `requirementKey`.
  3. For each bucket with more than one entry, look at the _standalone_ members. If there are two or more, keep the strongest and drop the rest. Then do the same separately for the members of each single group.
  4. If what remains of the bucket still spans more than one place, leave it as it is.
  5. Filter out the dropped indices, keeping the original order.
  6. For each group touched by a drop: if one member is left, remove the group and set that member's `group` to `null`; else clamp `min` to the member count.

  Use a local `KIND_RANK = { main: 3, must: 2, nice: 1 }`. The matcher's `KIND_RANK` lives in another module; don't import across modules for three numbers.

- [ ] **Step 4:** Run `npx nx test xjobs -- rules/stack`. Expected: PASS.

- [ ] **Step 5: Commit**
  ```bash
  git add apps/xjobs/src/modules/processor/rules/stack.ts apps/xjobs/src/modules/processor/rules/stack.spec.ts
  git commit -m "feat(processor): merge clear duplicate tech requirements"
  ```

### Task 2: A duplicate message the model can act on

**Files:**

- Modify: `apps/xjobs/src/modules/processor/rules/stack.ts` (the duplicate branch of `stackIssues`)
- Test: `apps/xjobs/src/modules/processor/rules/stack.spec.ts`

**Interfaces:**

- Consumes: `requirementKey` from Task 1.
- Produces: the message format below. The path stays `['requirements', i, 'technology']`, where `i` is the later copy.

Exact message. `<place>` is `on its own` or `group <id>`. `<tech>` is the code, or the trimmed text when the code is null. `<domain>` is `in domain <d>`, or `with no domain` when the domain is null.

```
"<first text>" (requirements.<j>, <place>) and "<later text>" (requirements.<i>, <place>) are the same technology (<tech>) <domain>; list it once
```

- [ ] **Step 1: Write the failing test** `names both texts of a duplicate`. Use standalone `{ text: 'AWS', code: 'aws' }` at index 0 and `{ text: 'Amazon Web Services', code: 'aws' }` in group `g1` at index 1, with `gcp` also in `g1`, `min: 1`, all with domain `devops`. Expect `stackErrors` to contain exactly:

  ```
  techStack.value.requirements.1.technology: "AWS" (requirements.0, on its own) and "Amazon Web Services" (requirements.1, group g1) are the same technology (aws) in domain devops; list it once
  ```

  Keep the existing `rejects a duplicate (code, domain)` test as it is.

- [ ] **Step 2:** Run `npx nx test xjobs -- rules/stack`. Expected: FAIL on the message.

- [ ] **Step 3:** Change the duplicate branch. Replace the `seen` set with a `Map<string, number>` from key to first index, so the message can name the first copy.

- [ ] **Step 4:** Run `npx nx test xjobs -- rules/stack processor/schema facts`. Expected: PASS. No other spec asserts the old `appears twice` text; confirm with `grep -rn "appears twice" apps/xjobs/src`, which should find nothing.

- [ ] **Step 5: Commit**
  ```bash
  git add apps/xjobs/src/modules/processor/rules/stack.ts apps/xjobs/src/modules/processor/rules/stack.spec.ts
  git commit -m "feat(processor): name both texts in the duplicate requirement error"
  ```

### Task 3: Wire the merge into the assembler and log it

**Files:**

- Modify: `apps/xjobs/src/modules/processor/services/fact-assembler.service.ts`
- Modify: `apps/xjobs/src/modules/processor/services/generation.service.ts`
- Test: `apps/xjobs/src/modules/processor/services/extraction-pipeline.service.spec.ts`

**Interfaces:**

- Consumes: `mergeDuplicateRequirements(stack): MergedStack` from Task 1.
- Produces: `AssembledDocument.mergedDuplicates: string[]` (the `dropped` list, `[]` when the stack is null or nothing merged).

- [ ] **Step 1: Write the failing tests** in `extraction-pipeline.service.spec.ts`. Patch `techStack` through `generatorOutput({ techStack: mf({...}) })`.
  - `merges two aliases of one technology`: requirements `{ text: '.NET Core', code: null }` and `{ text: 'ASP.NET', code: null }`, both `must 6`, domain `backend`, `groups: []`. The seed vocabulary maps both to `dotnet`. Expect `steps()` to equal `[['generation', 'ok']]`, and expect the document's `techStack.value.requirements` to hold exactly one `dotnet` with text `.NET Core`.
  - `retries a technology listed on its own and in a group, then fails`: standalone `AWS`, plus `Amazon Web Services` and `GCP` in `g1` (`min: 1`), all `devops`. Expect `extraction.calls[1].req.retryErrors?.join('\n')` to contain `are the same technology (aws) in domain devops; list it once`. Expect the run to reject with `ExtractionFailed`, the same way the existing "retries a schema failure … then fails" test asserts it.

- [ ] **Step 2:** Run `npx nx test xjobs -- extraction-pipeline`. Expected: the first test FAILS with an assembler error, and the second FAILS on the message (if Task 2 isn't in yet) or passes.

- [ ] **Step 3:** In `FactAssembler.assemble`, after `resolveTerms`: if `terms.doc.techStack.value` is set, replace it with `mergeDuplicateRequirements(...).stack`. Do this on the doc `resolveTerms` already cloned. Then call `checkStack` and return `mergedDuplicates`. In `GenerationService.generate`, after the existing `document assembled` debug line, add this when `mergedDuplicates.length > 0`:

  ```ts
  log.debug(`merged ${n} duplicate requirements (${mergedDuplicates.join(', ')})`);
  ```

- [ ] **Step 4:** Run `npx nx test xjobs -- processor`. Expected: PASS.

- [ ] **Step 5: Commit**
  ```bash
  git add apps/xjobs/src/modules/processor/services/fact-assembler.service.ts apps/xjobs/src/modules/processor/services/generation.service.ts apps/xjobs/src/modules/processor/services/extraction-pipeline.service.spec.ts
  git commit -m "feat(processor): merge duplicate requirements before the stack check"
  ```

### Task 4: Verify and open the PR

**Files:**

- Modify: `docs/superpowers/specs/2026-11-16-duplicate-requirements-design.md` (Status: `approved 2026-11-16`)

- [ ] **Step 1:** Run `npx nx run-many -t lint test build typecheck`. Expected: all green.
- [ ] **Step 2:** Run `pnpm --filter @xjobs/xjobs processor:eval` if the local claude token is set up. The bars already fail on unreviewed labels; compare with the run on `main`, and expect it not to be worse. If no token is available, skip this step and say so in the PR.
- [ ] **Step 3: Commit** the spec status, then `git push -u origin fix/merge-duplicate-requirements` and `gh pr create --base main`. The PR body includes today's numbers (11 of 12 failures, the five codes) and the week-later check from the spec's Rollout section.
