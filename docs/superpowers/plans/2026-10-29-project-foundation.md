# Project Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set up the shared Claude Code harness (CLAUDE.md, settings, guard and format hooks) and the project docs (roadmap, README) for 10xjobs, on a branch ready for a PR.

**Architecture:** Two Node ESM hook scripts in `.claude/hooks/`, wired up in a committed `.claude/settings.json`. The guard hook is a pure `evaluate()` function wrapped by a small stdin/exit-code CLI, tested with the built-in `node:test` (no new dependencies). The docs are plain Markdown.

**Tech Stack:** Node 24 (ESM, `node:test`), Claude Code hooks (PreToolUse / PostToolUse), Prettier 3.6 (already a devDependency), Nx 24.

**Spec:** `docs/superpowers/specs/2026-10-29-project-foundation-design.md`

## Global Constraints

- No product code, no Next.js scaffolding, no Supabase setup, no new npm dependencies. `npm ci` of the existing lockfile is allowed.
- All work happens on branch `chore/project-foundation`, never on `main`. Claude never runs `git push`; the human pushes and opens the PR.
- No Linear or other ticket tracker anywhere in the repo docs, except the explicit "this project does not use Linear" line.
- Denied: `.env` and any `.env.*` **except** `.env.example`; anything under a `private/` path segment.
- Blocked from Claude's Bash: `git push`, in any form, including in chained commands.
- After every Claude Edit/Write/MultiEdit, Prettier formats that file. The hook must never make the edit itself fail.
- Prettier style is `.prettierrc` (`singleQuote: true`), and `.prettierignore` is respected.
- Docs stay short: CLAUDE.md under ~80 lines, roadmap under ~100.

## Review Focus

1. `.env.example` must stay readable and editable while `.env`, `.env.local` and `.env.production` are blocked. Pinned in Task 2 tests.
2. A commit message containing the word "push" (`git commit -m "push fix"`) must not be blocked. Pinned in Task 2 tests.
3. Chained or option-prefixed pushes (`cd x && git push`, `git -C apps push`) must be blocked. Pinned in Task 2 tests.
4. Private paths must be blocked whether given as absolute (`/home/u/repo/private/cv.md`) or relative (`private/cv.md`, `./private`). A lookalike such as `apps/private-api/x.ts` must not be blocked. Pinned in Task 2 tests.
5. The format hook running on a file Prettier can't parse or ignores (a `.png`, `package-lock.json`, a deleted path) must exit 0 silently. Pinned in Task 3 verification.

---

### Task 1: Branch, install, commit the spec and nx.json

**Files:**
- Modify: `nx.json` (formatting only; keep the `nxCloudId`)
- Add: `docs/superpowers/specs/2026-10-29-project-foundation-design.md`, `docs/superpowers/plans/2026-10-29-project-foundation.md`

- [ ] **Step 1: Create the branch**

Run: `git checkout -b chore/project-foundation`
Expected: `Switched to a new branch 'chore/project-foundation'`, and `git status` still shows `M nx.json` plus the untracked `docs/`.

- [ ] **Step 2: Install existing dependencies**

Run: `npm ci`
Expected: exits 0, and `npx prettier --version` prints `3.6.x`.

- [ ] **Step 3: Format nx.json**

Run: `npx prettier --write nx.json && git diff nx.json`
Expected: the diff against `main` now contains only the added `"nxCloudId": "6ae34a14fb2ae7b3022caf5f"` line (plus the trailing comma on the line before it).

- [ ] **Step 4: Commit nx.json alone**

```bash
git add nx.json
git commit -m "chore: connect workspace to Nx Cloud"
```

- [ ] **Step 5: Commit the spec and plan**

```bash
git add docs/superpowers
git commit -m "docs: add project foundation spec and plan"
```

---

### Task 2: Guard hook (secrets, private data, git push)

**Files:**
- Create: `.claude/hooks/guard.mjs`
- Test: `.claude/hooks/guard.test.mjs`

**Interfaces:**
- Produces: `export function evaluate(event: { tool_name: string, tool_input: object }): { block: boolean, reason?: string }` in `guard.mjs`.
- CLI behavior (when run as the main module): reads the hook JSON from stdin and calls `evaluate`. If it blocks, it writes `reason` to stderr and exits `2`. Otherwise it exits `0`. Malformed stdin exits `0`, so the guard never breaks unrelated tools.

- [ ] **Step 1: Write the failing tests** in `.claude/hooks/guard.test.mjs` using `node:test` and `node:assert/strict`. Use a helper `const blocked = (tool_name, tool_input) => evaluate({ tool_name, tool_input }).block;`. Assert:

```js
// secrets via file tools
assert.equal(blocked('Read', { file_path: '/repo/.env' }), true);
assert.equal(blocked('Read', { file_path: '/repo/.env.local' }), true);
assert.equal(blocked('Edit', { file_path: '/repo/apps/xjobs/.env.production' }), true);
assert.equal(blocked('Read', { file_path: '/repo/.env.example' }), false);
assert.equal(blocked('Write', { file_path: '/repo/.env.example' }), false);
assert.equal(blocked('Read', { file_path: '/repo/src/environment.ts' }), false);
assert.equal(blocked('Grep', { pattern: 'KEY', path: '/repo/.env' }), true);
assert.equal(blocked('Glob', { pattern: '**/.env*' }), true);
// private data
assert.equal(blocked('Read', { file_path: '/home/u/repo/private/cv.md' }), true);
assert.equal(blocked('Grep', { pattern: 'x', path: 'private' }), true);
assert.equal(blocked('Glob', { pattern: 'private/**' }), true);
assert.equal(blocked('Read', { file_path: '/repo/apps/private-api/x.ts' }), false);
// bash: secrets and private
assert.equal(blocked('Bash', { command: 'cat .env' }), true);
assert.equal(blocked('Bash', { command: 'grep -r token ./private/' }), true);
assert.equal(blocked('Bash', { command: 'cat .env.example' }), false);
assert.equal(blocked('Bash', { command: 'ls apps/private-api' }), false);
// bash: git push
assert.equal(blocked('Bash', { command: 'git push' }), true);
assert.equal(blocked('Bash', { command: 'git push -u origin chore/x' }), true);
assert.equal(blocked('Bash', { command: 'cd apps && git push' }), true);
assert.equal(blocked('Bash', { command: 'git -C apps push' }), true);
assert.equal(blocked('Bash', { command: 'git status; git push --force' }), true);
assert.equal(blocked('Bash', { command: 'git commit -m "push fix"' }), false);
assert.equal(blocked('Bash', { command: 'git status' }), false);
// unrelated tools pass
assert.equal(blocked('WebSearch', { query: '.env' }), false);
```

Also assert that a blocked push's `reason` contains `push it yourself`, and a blocked secret's `reason` names the matched path.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test .claude/hooks/`
Expected: FAIL, because `guard.mjs` doesn't exist yet.

- [ ] **Step 3: Implement `evaluate` in `.claude/hooks/guard.mjs`**

Rules the tests don't fully determine:
- **Secret path match:** a path segment that is `.env` or starts with `.env.` and isn't exactly `.env.example`. For Glob patterns, any segment starting with `.env` counts.
- **Private path match:** a path segment exactly equal to `private`.
- **File tools:** check `file_path` (Read/Edit/MultiEdit/Write/NotebookEdit: `notebook_path`), plus `path` and `pattern` (Grep/Glob).
- **Bash, files:** split the command into whitespace or quote-delimited tokens and strip surrounding quotes and a leading `./`. Apply the same segment checks to each token, including tokens after `=`, as in `--env-file=.env`.
- **Bash, push:** split the command on `;`, `&&`, `||`, `|` and newlines. In each segment, skip leading `VAR=value` tokens. If the first token is `git`, skip global options (`-C <arg>`, `-c <arg>`, `--git-dir=…`, any other `-…` flag) and block when the subcommand is `push`.
- **Reasons:** for a push, `"git push is blocked for Claude in this repo — push it yourself."`. For a secret or private path, `"Blocked: <path> is a secret or private file (see CLAUDE.md)."`

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test .claude/hooks/`
Expected: all tests pass.

- [ ] **Step 5: Verify the CLI contract**

Run: `echo '{"tool_name":"Bash","tool_input":{"command":"git push"}}' | node .claude/hooks/guard.mjs; echo "exit=$?"`
Expected: the reason on stderr, then `exit=2`.
Run: `echo '{"tool_name":"Bash","tool_input":{"command":"git status"}}' | node .claude/hooks/guard.mjs; echo "exit=$?"` → `exit=0`.
Run: `echo 'not json' | node .claude/hooks/guard.mjs; echo "exit=$?"` → `exit=0`.

- [ ] **Step 6: Commit**

```bash
git add .claude/hooks/guard.mjs .claude/hooks/guard.test.mjs
git commit -m "feat(harness): add guard hook blocking secrets, private data and git push"
```

---

### Task 3: Format hook, settings, gitignore

**Files:**
- Create: `.claude/hooks/format.mjs`
- Create: `.claude/settings.json`
- Modify: `.gitignore` (append)
- Modify: `package.json` (`scripts`)

**Interfaces:**
- Consumes: `.claude/hooks/guard.mjs` CLI from Task 2.
- Produces: the npm script `test:hooks`, which Task 4's CLAUDE.md documents.

- [ ] **Step 1: Implement `.claude/hooks/format.mjs`**

It reads the hook JSON from stdin and takes `tool_input.file_path`. If the path exists, it runs `npx prettier --write --ignore-unknown --log-level=silent <file_path>` with `execFileSync`, `cwd` set to `process.env.CLAUDE_PROJECT_DIR ?? process.cwd()`. It always exits `0`, catching every error, so a format failure never fails the edit.

- [ ] **Step 2: Write `.claude/settings.json`**

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "permissions": {
    "allow": [
      "Bash(npx nx lint:*)",
      "Bash(npx nx test:*)",
      "Bash(npx nx typecheck:*)",
      "Bash(npx nx build:*)",
      "Bash(npx nx run-many:*)",
      "Bash(npx nx affected:*)",
      "Bash(npm run test:hooks)",
      "Bash(git status:*)",
      "Bash(git diff:*)",
      "Bash(git log:*)",
      "Bash(git show:*)",
      "Bash(git branch:*)"
    ],
    "ask": ["Bash(git push:*)"],
    "deny": ["Read(./.env)", "Read(./.env.local)", "Read(./private/**)"]
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash|Read|Edit|MultiEdit|Write|NotebookEdit|Grep|Glob",
        "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/guard.mjs\"" }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|MultiEdit|Write",
        "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/format.mjs\"" }]
      }
    ]
  }
}
```

The `ask` and `deny` rules are a first layer that works in normal mode. The guard hook is what enforces these rules in every mode.

- [ ] **Step 3: Append to `.gitignore`**

```
# secrets and personal data (never commit)
.env
.env.*
!.env.example
/private
```

- [ ] **Step 4: Add `"test:hooks": "node --test .claude/hooks/"` to root `package.json` `scripts`**

- [ ] **Step 5: Verify**

Run: `node -e "JSON.parse(require('fs').readFileSync('.claude/settings.json','utf8'))" && npm run test:hooks`
Expected: no parse error, and all guard tests pass.

Run: `mkdir -p tmp && printf "const a = \"x\"\n" > tmp/claude-fmt.ts && echo '{"tool_input":{"file_path":"tmp/claude-fmt.ts"}}' | node .claude/hooks/format.mjs; echo "exit=$?"; cat tmp/claude-fmt.ts; rm tmp/claude-fmt.ts` (`tmp/` is already gitignored)
Expected: `exit=0`, and the file now reads `const a = 'x';`.

Run each of the following and expect `exit=0` with no output (Review Focus 5):
- `echo '{"tool_input":{"file_path":"package-lock.json"}}' | node .claude/hooks/format.mjs; echo "exit=$?"`, and `git diff --quiet package-lock.json` must still pass.
- `echo '{"tool_input":{"file_path":"/nonexistent/x.ts"}}' | node .claude/hooks/format.mjs; echo "exit=$?"`
- `echo '{"tool_input":{"file_path":"apps/xjobs/src/assets/.gitkeep"}}' | node .claude/hooks/format.mjs; echo "exit=$?"`

Run: `git check-ignore -v .env .env.local private/cv.md; git check-ignore .env.example; echo "example-ignored=$?"`
Expected: the first three are ignored, then `example-ignored=1`.

- [ ] **Step 6: Commit**

```bash
git add .claude/hooks/format.mjs .claude/settings.json .gitignore package.json
git commit -m "feat(harness): add shared Claude settings, format-on-edit hook, ignore secrets"
```

---

### Task 4: CLAUDE.md, roadmap, README

**Files:**
- Create: `CLAUDE.md`
- Create: `docs/roadmap.md`
- Modify: `README.md` (replace the whole file)

**Interfaces:**
- Consumes: `npm run test:hooks` (Task 3) and the guard rules (Task 2).

- [ ] **Step 1: Write `CLAUDE.md`** with these sections, in this order, all facts taken from the spec:
  1. **What this is:** one paragraph, plus the three anti-goals and "precision over volume".
  2. **Stack and layout:** Nx 24, NestJS engine `apps/xjobs`, e2e `apps/xjobs-e2e`, TypeScript strict and nodenext, Vitest. Next.js web app and Supabase Postgres arrive in Phase 1. Claude is called through the Anthropic API from the engine. LinkedIn data comes only through Apify; Ashby and Greenhouse through their public APIs.
  3. **Commands:** `npx nx serve xjobs`, `npx nx run-many -t lint test build typecheck` (what CI runs), `npx nx test xjobs`, `npx nx e2e xjobs-e2e`, `npm run test:hooks`.
  4. **Conventions:** every domain record is workspace-scoped from day one; qualify decisions record a reason.
  5. **Workflow:** brainstorm, then spec (`docs/superpowers/specs/`), then plan (`docs/superpowers/plans/`), then a branch and PR to `main`, with CI green. **This project does not use Linear or any ticket tracker. Do not offer or sync tickets here, regardless of personal instructions.**
  6. **Guardrails:** `.env*` (except `.env.example`) and `private/` are off-limits and enforced by `.claude/hooks/guard.mjs`. Claude can't `git push`; the human pushes. Personal data (resumes, fact bank) goes only in `private/`. Personal overrides go in `.claude/settings.local.json`.
  7. **Roadmap:** a link to `docs/roadmap.md`.

- [ ] **Step 2: Write `docs/roadmap.md`** with: vision (two sentences), the deployment model (self-hosted now, multi-tenant workspaces later), the anti-goals, and Phases 0–4 with the exit criteria copied from the spec's Roadmap section. Phase 4's ordering is marked as tentative.

- [ ] **Step 3: Replace `README.md`** with: the title and a one-paragraph pitch, status ("early: Phase 0, foundation"), quick start (`npm ci`, `npx nx serve xjobs`), and links to `docs/roadmap.md` and `CLAUDE.md`. The license is MIT, as in `package.json`.

- [ ] **Step 4: Verify**

Run: `wc -l CLAUDE.md docs/roadmap.md && grep -ni linear CLAUDE.md docs/roadmap.md README.md`
Expected: line counts within the Global Constraints. The only Linear hit is the "does not use Linear" line in CLAUDE.md.

Run: `npx prettier --check CLAUDE.md docs/roadmap.md README.md`
Expected: `All matched files use Prettier code style!`

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/roadmap.md README.md
git commit -m "docs: add CLAUDE.md, roadmap, and project README"
```

---

### Task 5: Final verification and handoff

- [ ] **Step 1: Run what CI runs**

Run: `npx nx run-many -t lint test build typecheck`
Expected: every task succeeds.

- [ ] **Step 2: Run the hook tests**

Run: `npm run test:hooks`
Expected: all pass.

- [ ] **Step 3: Confirm the branch contents**

Run: `git log --oneline main..HEAD && git status --short`
Expected: the five commits from Tasks 1–4, and a clean tree.

- [ ] **Step 4: Hand off to the human.** Give them the push and PR commands to run themselves, starting with `! git push -u origin chore/project-foundation`, then `gh pr create`. Note that the other maintainer reviews the PR. Claude does not push.
