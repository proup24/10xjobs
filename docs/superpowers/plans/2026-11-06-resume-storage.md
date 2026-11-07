# Resume Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The web app, acting as the signed-in user, can upload, replace and download a profile's resume PDF, on drafts and published profiles, and the database and Storage policies guarantee no user can reach or point at another user's file.

**Architecture:** One migration creates the `resumes` bucket, the Storage policies on `storage.objects`, and a `SECURITY DEFINER` function `set_profile_resume`, the only writer of the resume columns. The browser uploads and downloads directly against Storage with the user's session, because of Vercel's 4.5 MB body limit. A server action confirms each upload: it checks the bytes, hashes them, calls the function and cleans the folder. The engine side (removing its resume endpoints) is added to the teammate's step 2 of the preferences and eligibility plan.

**Tech Stack:** Prisma 8 migrations (`rawSql` ops, `@prisma/orm-postgres`), Supabase Storage on the Supabase CLI local stack, plpgsql, Next.js 16 App Router server actions, `@supabase/ssr` / `supabase-js` 2, Vitest (`apps/db-tests` against the stack, `apps/web` unit tests with fakes).

**Spec:** `docs/superpowers/specs/2026-11-06-resume-storage-design.md`

**Linear ticket:** none (this project uses no ticket tracker).

**Branches and PRs:**

- PR `feat/resume-storage` (Tasks 1–5, the user's), carrying the spec, this plan and the roadmap edits (already committed on `docs/resume-storage-spec`; rebase or branch from it).
- The engine work is Task 10a of `docs/superpowers/plans/2026-11-05-preferences-and-eligibility.md`, in the teammate's PR B. Task 5 adds it there. It doesn't block this PR.

## Global Constraints

- **Bucket:** id and name `resumes`, `public = false`, `file_size_limit = 5242880` (5 MiB), `allowed_mime_types = '{application/pdf}'`. The same values in the migration, `supabase/config.toml` (`"5MiB"`) and the web app's `MAX_RESUME_BYTES = 5_242_880`.
- **Object key:** `<userId>/<profileId>/<uuid>.pdf`, all three lowercase UUIDs. Pattern: `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/<same>/<same>\.pdf$`. The user's filename is never in a key, URL or log line.
- **The resume columns** (`resumeKey`, `resumeFilename`, `resumeSizeBytes`, `resumeSha256`, `resumeUploadedAt`) stay out of `authenticated`'s column grants. `set_profile_resume` is the only way a user changes them, on drafts and published profiles.
- **Filename cleaning** (in SQL, the same rule as the engine's `safeFilename` in `apps/xjobs/src/utils/name.ts`): keep the part after the last `/` or `\`, replace every character outside `[A-Za-z0-9_.\- ]` with `_`, cut to 200 characters, trim, and use `resume.pdf` if empty.
- **The web app never holds the service-role key** (`apps/web/src/no-service-role.spec.ts`). Every Storage and RPC call in `apps/web` goes through the user's session client.
- **Logging:** log lines may include the profile id and a Storage or Postgres error code. Never the filename, the key's contents beyond ids, or file bytes.
- **Migrations:** create with `pnpm --filter @xjobs/database exec prisma migration new --name <slug>`, edit only the `operations` getter, self-emit with `node <package>/migration.ts`. Never write a package from a blank file, never edit an existing migration. Follow the same-hash `rawSql` shape of `libs/database/src/migrations/app/20261105T2208_code_check_fixes/migration.ts`: `operationClass: 'data'`, an `invariantId`, and the invariant added to `refs/db.json`. **`refs/db.json` must keep `end-expired-sessions` and `code-check-fixes`** next to the new `resume-storage`.
- **Tests:** in `apps/db-tests`, the operation under test goes through a signed-in `supabase-js` client (`TestUser.client`). The service role (`admin()`) and `withCatalog` are only for setup and read-back. Isolation is asserted by outcome (object still there, column unchanged, list empty), not only by an error.
- After the migration, regenerate types with `pnpm db:types` (the function appears under `Functions`).
- CI must be green: `npx nx run-many -t lint test build typecheck` and `pnpm db:test`. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Claude doesn't push.

## Review Focus

1. **Two uploads confirmed at once on the same profile.** Confirm 1's cleanup can run after confirm 2's swap. Expected: cleanup never deletes the key the profile points at _now_. It re-reads `resumeKey` after the swap and skips it. Test in Task 3 (`keeps the current key even if another upload won`).
2. **A policy subquery that resolves `name` or `id` against the wrong table.** `storage.objects.name` and `public.profiles.id` must be qualified inside `EXISTS`. Expected: A can't upload into `<A>/<B's profileId>/`. Test in Task 1.
3. **A hostile filename** (`../../x/évil<script>.pdf`, an empty string, 300 characters). Expected: the stored name is cleaned, and the key is unaffected. Test in Task 2.
4. **`confirmResume` with a key for another profile or user.** Expected: refused before any download or delete, so no file is touched. Test in Task 3.
5. **Test users deleted with files still in the bucket.** Expected: `cleanupTestUsers` empties `resumes/<id>/` with the service role first, so runs don't pile up objects. Covered in Task 1, step 1.

---

### Task 1: Bucket and Storage policies

**Files:**

- Create: migration package `libs/database/src/migrations/app/<ts>_resume_storage/` (via `prisma migration new --name resume_storage`).
- Modify: `libs/database/src/migrations/app/refs/db.json` (add `"resume-storage"` to `invariants`).
- Modify: `supabase/config.toml`: the `[storage.buckets.resumes]` comment says users write under their own folder through Storage policies, and the engine reads with the service role.
- Modify: `apps/db-tests/src/support/test-users.ts`: `cleanupTestUsers` first lists and removes every object under `resumes/<id>/` with `admin()`, recursing into the profile folders.
- Modify: `apps/db-tests/src/support/fixtures.ts`: add `resumeKeyFor(userId, profileId): string` (new UUID each call), `pdfBytes(size = 1024): Uint8Array` (starts with `%PDF-1.7\n`, padded to `size`), and `publishProfile(profileId)` (admin update of `state: 'published'`, `publishedAt: now`) if `profile-freeze.db.spec.ts` doesn't already export an equivalent. Move it into fixtures if it does.
- Test: `apps/db-tests/src/resume-storage.db.spec.ts`

**Interfaces:**

- Produces: bucket `resumes`; policies `resumes_select_own`, `resumes_insert_own`, `resumes_delete_own` on `storage.objects`; no `UPDATE` policy. Fixtures `resumeKeyFor`, `pdfBytes`, `publishProfile`.

- [ ] **Step 1: Test-user cleanup and fixtures**, as listed under Files. Run `pnpm db:test` and expect the existing suites to still PASS.

- [ ] **Step 2: Write the failing tests.** In `resume-storage.db.spec.ts`, with users `a` and `b` and profiles `aDraft`, `aPub` (published), `bDraft`. Upload with `client.storage.from('resumes').upload(key, pdfBytes(), { contentType: 'application/pdf' })`.
  - `bucket row has the agreed limits`: via `withCatalog`, `select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'resumes'` returns `false`, `5242880`, `{application/pdf}`.
  - `A uploads, lists, downloads and deletes in A's own folder`: all succeed, and `list('<a>/<aDraft>')` shows the file.
  - `A cannot upload into B's folder`: `upload(resumeKeyFor(b.id, bDraft))` errors, and the admin list of `<b>/<bDraft>` is empty.
  - `A cannot upload into A's folder under B's profile`: `upload(resumeKeyFor(a.id, bDraft))` errors, and nothing is stored.
  - `A cannot upload a key with the wrong layout`: `'<a>/<aDraft>/cv.pdf'`, `'<a>/x.pdf'` and `'<a>/<aDraft>/<uuid>.txt'` all error.
  - `A cannot read, list or delete B's file`: with a B file uploaded by `b.client`, `a.client` `download` errors, `list('<b>/<bDraft>')` returns `[]`, `remove([key])` leaves the admin list with one item.
  - `no one can overwrite`: `upload(sameKey, pdfBytes(), { upsert: true })` by the owner errors, and the admin download is still the original bytes (compare length with a different `pdfBytes(2048)`).
  - `the bucket refuses a non-PDF type`: `contentType: 'text/plain'` errors.
  - `the bucket refuses a file over 5 MiB`: `pdfBytes(5_242_881)` errors.
  - `A cannot delete the live file of a published profile` and `A can delete the live file of a draft`: set `resumeKey` with `admin()` on `aPub` and on `aDraft`, then `a.client.remove`. The first object stays and the second is gone.
  - `anon cannot read or upload`: `anon()` `upload` and `list` both fail or return nothing.

- [ ] **Step 3: Run them and see them fail.** `pnpm db:test -- resume-storage`. Expected: FAIL (the bucket exists from `config.toml`, but there are no policies, so user uploads are refused).

- [ ] **Step 4: The migration.** `prisma migration new --name resume_storage`, with one `rawSql` op (`invariantId: 'resume-storage'`, `operationClass: 'data'`, empty postcheck). It contains:
  - `INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES (...) ON CONFLICT (id) DO UPDATE SET` the same four values.
  - Two helpers, both `STABLE SECURITY DEFINER SET search_path = ''`, with `REVOKE ALL ... FROM PUBLIC` and `GRANT EXECUTE ... TO authenticated`:
    - `public.resume_folder_is_own(object_name text) RETURNS boolean`: `(storage.foldername(object_name))[1] = auth.uid()::text`, and a `public.profiles` row with `p.id::text = (storage.foldername(object_name))[2]` has `p."userId" = auth.uid()`.
    - `public.resume_key_is_own(object_name text) RETURNS boolean`: `object_name` matches the key pattern, and `resume_folder_is_own(object_name)`.
  - `resumes_select_own`: `FOR SELECT TO authenticated USING (bucket_id = 'resumes' AND public.resume_folder_is_own(name))`. This check is folder-level, so `list()` works.
  - `resumes_insert_own`: `FOR INSERT TO authenticated WITH CHECK (bucket_id = 'resumes' AND public.resume_key_is_own(name))`.
  - `resumes_delete_own`: `FOR DELETE TO authenticated USING (bucket_id = 'resumes' AND public.resume_folder_is_own(name) AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p."resumeKey" = objects.name AND p.state = 'published'))`.
  - No UPDATE policy.

  Self-emit, add `"resume-storage"` to `refs/db.json` invariants (keeping the other two), then run `pnpm db:migrate`. If creating policies on `storage.objects` fails with `42501` as `postgres`, stop and report. Don't work around it with ownership changes.

- [ ] **Step 5: Run the tests.** `pnpm db:test`. Expected: all PASS, including `rls-enabled` and the existing freeze tests.

- [ ] **Step 6: Commit.**

```bash
git add libs/database/src/migrations supabase/config.toml apps/db-tests/src
git commit -m "feat(storage): resumes bucket and per-user Storage policies"
```

### Task 2: `set_profile_resume`

**Files:**

- Modify: the `resume_storage` migration from Task 1 if it isn't committed to `main` yet (it isn't: same PR). Add a second `rawSql` op with the same `invariantId`, then re-emit. Otherwise create `<ts>_set_profile_resume`.
- Modify: `libs/database/src/supabase/database.types.ts` (via `pnpm db:types`).
- Test: `apps/db-tests/src/resume-swap.db.spec.ts`

**Interfaces:**

- Consumes: Task 1's bucket, policies and fixtures.
- Produces: `public.set_profile_resume(profile_id uuid, key text, filename text, sha256 text) RETURNS text` (the previous `resumeKey`, or null). Called from `supabase-js` as `client.rpc('set_profile_resume', { profile_id, key, filename, sha256 })`. Errors: `42501` when the caller doesn't own the profile; `23514` with message `set_profile_resume: <reason>` for a bad layout, a key outside `<auth.uid()>/<profile_id>/`, a missing object, or a `sha256` that isn't 64 lowercase hex. Messages never include the filename.

- [ ] **Step 1: Write the failing tests** in `resume-swap.db.spec.ts`. Each one uploads with the owner's client first, where it needs an object.
  - `sets the columns on A's draft`: returns null, and the admin row has `resumeKey = key`, `resumeFilename = 'cv.pdf'`, `resumeSizeBytes = 1024` (from `pdfBytes(1024)`), `resumeSha256` as passed, and `resumeUploadedAt` within 10 s of now.
  - `sets the columns on A's published profile`: the same, on `aPub`. `state` stays `published`, and no other column changes (compare the admin row minus the resume columns and `updatedAt`).
  - `returns the previous key on replace`.
  - `takes the size from Storage`: upload `pdfBytes(3000)`, and the row says `3000`.
  - `refuses B's profile`: error code `42501`, and B's row is unchanged.
  - `refuses a key in B's folder`, `refuses a key for another of A's profiles`, `refuses a key with the wrong layout`, `refuses a key with no object`, `refuses a bad sha256`: all `23514`, and A's row is unchanged.
  - `cleans the filename`: `'../../x/évil<script>.pdf'` → `'_vil_script_.pdf'`, `''` → `'resume.pdf'`, a 300-character name → 200 characters.
  - `the error message never contains the filename`: pass a filename `'secret-name.pdf'` with a bad key, and the message doesn't include `secret-name`.
  - `anon cannot call it`: `anon().rpc(...)` errors.

- [ ] **Step 2: Run them and see them fail.** `pnpm db:test -- resume-swap`. Expected: FAIL, because the function doesn't exist.

- [ ] **Step 3: Add the function** as specified under Interfaces. It is plpgsql, `SECURITY DEFINER SET search_path = ''`. It selects the profile `FOR UPDATE` where `id = profile_id AND "userId" = auth.uid()`. It reads size from `storage.objects.metadata->>'size'` (`bucket_id = 'resumes' AND name = key`), and cleans the filename by the Global Constraints rule. `REVOKE ALL FROM PUBLIC, anon`; `GRANT EXECUTE TO authenticated`. Re-emit, run `pnpm db:migrate`, then `pnpm db:types`.

- [ ] **Step 4: Run the tests.** `pnpm db:test`. Expected: all PASS.

- [ ] **Step 5: Commit.**

```bash
git add libs/database/src apps/db-tests/src
git commit -m "feat(db): set_profile_resume, the only writer of a profile's resume"
```

### Task 3: Confirming an upload (server side)

**Files:**

- Create: `apps/web/src/lib/resume/key.ts`, `apps/web/src/lib/resume/pdf.ts`, `apps/web/src/lib/resume/confirm.ts`, `apps/web/src/lib/resume/actions.ts` (`'use server'`)
- Test: `apps/web/src/lib/resume/key.spec.ts`, `pdf.spec.ts`, `confirm.spec.ts`

**Interfaces:**

- Consumes: `set_profile_resume` (Task 2), `createSupabaseServerClient` (`apps/web/src/lib/supabase/server.ts`).
- Produces:
  - `key.ts`: `RESUMES_BUCKET = 'resumes'`, `MAX_RESUME_BYTES = 5_242_880`, `newResumeKey(userId: string, profileId: string, uuid?: string): string`, `isResumeKeyFor(key: string, userId: string, profileId: string): boolean`, `profileFolder(userId, profileId): string`.
  - `pdf.ts`: `checkPdf(bytes: Uint8Array): { ok: true; sha256: string } | { ok: false; reason: 'not-pdf' | 'too-large' }` (Node `crypto`, server only).
  - `confirm.ts`: `confirmResume(supabase: SupabaseClient<Database>, userId: string, input: { profileId: string; key: string; filename: string }, deps?: { log?: (line: string) => void }): Promise<ConfirmResult>`, where `ConfirmResult = { status: 'saved'; resume: { filename: string; sizeBytes: number; uploadedAt: string } } | { status: 'invalid'; reason: 'not-pdf' | 'too-large' | 'bad-key' } | { status: 'failed' }`.
  - `actions.ts`: `confirmResumeAction(input: { profileId: string; key: string; filename: string }): Promise<ConfirmResult>`. It reads `userId` from `supabase.auth.getClaims()` (`claims.sub`) and returns `{ status: 'failed' }` with no claims.

- [ ] **Step 1: Write the failing tests.** Fakes follow `apps/web/src/lib/auth/request-code.spec.ts` (a hand-rolled object of `vi.fn`s, typed with `as unknown as`).
  - `key.spec.ts`: `newResumeKey` gives `<u>/<p>/<uuid>.pdf`; `isResumeKeyFor` rejects another user, another profile, a non-UUID segment, an uppercase UUID, a `.txt` extension and an extra segment.
  - `pdf.spec.ts`: `%PDF-` bytes pass with the known SHA-256 of a fixed buffer; `%PDF` (4 bytes) and `<html>` give `not-pdf`; 5,242,881 bytes give `too-large`; exactly 5,242,880 pass.
  - `confirm.spec.ts`:
    - `refuses a key for another profile before touching Storage`: result `bad-key`; `download`, `remove` and `rpc` are never called.
    - `deletes the object and reports not-pdf`.
    - `saves, then removes every other file in the folder`: list returns `[old, stray, new]`, and `remove` gets `[old, stray]` with full paths.
    - `keeps the current key even if another upload won`: after the rpc, the profile re-read returns `resumeKey = other`, so `remove` gets neither `new` nor `other`.
    - `a failed cleanup still returns saved`, and logs a line with the profile id only.
    - `an rpc error returns failed and logs the code, not the filename`: assert no log argument contains the filename.

- [ ] **Step 2: Run them and see them fail.** `npx nx test web`. Expected: FAIL, because the modules don't exist.

- [ ] **Step 3: Implement.** In `confirmResume`, the order is:
  1. `isResumeKeyFor`.
  2. `storage.from(RESUMES_BUCKET).download(key)`, then `checkPdf`. On failure, `remove([key])`.
  3. `rpc('set_profile_resume', { profile_id, key, filename, sha256 })`.
  4. Re-read `resumeKey, resumeFilename, resumeSizeBytes, resumeUploadedAt` from `profiles` (the user can select them).
  5. `list(profileFolder(...))` and remove every name whose full path isn't the re-read `resumeKey`.
  6. Return `saved` with the re-read values.

- [ ] **Step 4: Run the tests.** `npx nx test web`. Expected: PASS, including `no-service-role.spec.ts`.

- [ ] **Step 5: Commit.**

```bash
git add apps/web/src/lib/resume
git commit -m "feat(web): confirm a resume upload: check, hash, swap and clean the folder"
```

### Task 4: Browser upload and download, and draft deletion

**Files:**

- Create: `apps/web/src/lib/resume/browser.ts` (browser only: no Node imports), `apps/web/src/lib/resume/delete-draft.ts`; add `deleteDraftProfileAction(profileId: string)` to `actions.ts`.
- Test: `apps/web/src/lib/resume/browser.spec.ts`, `delete-draft.spec.ts`

**Interfaces:**

- Consumes: `key.ts` and `confirmResumeAction` (Task 3), `createSupabaseBrowserClient` (`apps/web/src/lib/supabase/client.ts`).
- Produces:
  - `browser.ts`: `uploadResume(supabase, userId: string, profileId: string, file: File, confirm: typeof confirmResumeAction): Promise<ConfirmResult>`. It checks `file.type === 'application/pdf'` and `file.size <= MAX_RESUME_BYTES` first and returns `invalid` without uploading. It builds the key with `newResumeKey(userId, profileId, crypto.randomUUID())`, uploads with `contentType: 'application/pdf'` and `upsert: false`, then calls `confirm({ profileId, key, filename: file.name })`. An upload error returns `failed`.
  - `browser.ts`: `downloadResume(supabase, resume: { key: string; filename: string }, save?: (blob: Blob, filename: string) => void): Promise<'ok' | 'failed'>`. `download(key)`, then `save`. The default `save` creates an object URL and an `<a download={filename}>`, clicks it and revokes the URL.
  - `delete-draft.ts`: `deleteDraftProfile(supabase, userId: string, profileId: string): Promise<'deleted' | 'not-draft' | 'failed'>`.
  - `actions.ts`: `deleteDraftProfileAction(profileId: string)`, which wraps it with the claims user.

- [ ] **Step 1: Write the failing tests.**
  - `browser.spec.ts`:
    - `refuses a non-PDF or oversize file without uploading`.
    - `uploads to a key under the user's profile folder with upsert false, then confirms with the original filename`.
    - `an upload error returns failed and never confirms`.
    - `downloadResume passes the blob and the filename to save, and creates no signed URL` (`createSignedUrl` is never called).
  - `delete-draft.spec.ts`:
    - `returns not-draft and touches nothing for a published profile`.
    - `removes every file in the folder, then deletes the row`: in that call order.
    - `a failed row delete after the files are gone returns failed`.
    - `a failed file removal stops before deleting the row`.

- [ ] **Step 2: Run them and see them fail.** `npx nx test web`. Expected: FAIL.

- [ ] **Step 3: Implement** as specified under Interfaces. For `deleteDraftProfile`, read `state` first and return `not-draft` unless it's `draft`. Then list and remove the folder, then `from('profiles').delete().eq('id', profileId).eq('state', 'draft').select('id')`. An empty result returns `failed`.

- [ ] **Step 4: Run the tests and the full check.** `npx nx run-many -t lint test build typecheck`. Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/web/src/lib/resume
git commit -m "feat(web): browser resume upload and download, and draft deletion with its files"
```

### Task 5: Hand the engine work to step 2, and wrap up

**Files:**

- Modify: `docs/superpowers/plans/2026-11-05-preferences-and-eligibility.md`: add `### Task 10a: The resume endpoints go` between Task 10 and Task 11, in PR B. Its content is the spec's "Engine changes" list:
  - remove `ResumeController`, the `save`, `get` and `delete` methods of `ResumeService`, their DTOs (`ResumeInfoResponseDto` if unused) and tests;
  - `deleteProfile` and `removeAllFor` delete every object under `<userId>/<profileId>/` (Storage `list`, then `remove`), not only `resumeKey`;
  - remove `onModuleInit`'s `ensureBucket` (the migration creates the bucket), and keep `STORAGE_RESUMES_BUCKET`;
  - test: `deleteProfile` removes all of a folder's objects.

  Also add one line to that plan's Global Constraints: "Resume files are written only by the web app (see `2026-11-06-resume-storage.md`); the engine only reads and deletes them."

- [ ] **Step 1: Edit the plan** as above.
- [ ] **Step 2: Full verification.** `npx nx run-many -t lint test build typecheck`, `pnpm db:test`, and `git diff --exit-code libs/database/src/supabase/database.types.ts` after `pnpm db:types`. Expected: all PASS, and no type diff.
- [ ] **Step 3: Commit, then write the PR description.** Include: the new invariant `resume-storage` (any later `refs/db.json` change must keep all three invariants); that the engine's resume endpoints still work until Task 10a lands; and that production must run migrations as `postgres` (slice 09).

```bash
git add docs/superpowers/plans
git commit -m "docs: hand the engine's resume changes to step 2 of the preferences plan"
```
