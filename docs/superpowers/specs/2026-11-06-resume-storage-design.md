# Resume storage

Phase 1, slice 06 ([brief](../../roadmap/phase-1-accounts-and-preferences/06-resume-storage.md)). Date: 2026-11-06.

## Intent

Each profile holds one resume PDF, which Phase 3 sends with applications as it is. Today only the engine can store it: it uses the service-role key, behind temporary endpoints. This slice moves resume storage to the web app, which acts as the signed-in user, so Storage policies and the database enforce isolation instead of engine code.

Resumes are personal data. The failure that matters most is one user's resume reaching another user, or being sent on another user's behalf. Phase 3's engine bypasses RLS, so if a profile could point at another user's file, the engine would send it.

## Decisions

- **A resume can be replaced at any time, on published profiles too** _(user's decision)_. The resume columns become the one exception to "published profiles are frozen". Every other field stays frozen. Changing the resume doesn't touch the shared search queries, so it doesn't need the engine.
- **One resume per profile for now.** Applying with different resumes per role comes later _(user's decision)_. Nothing here should make that harder, but none of it is built.
- **Backend only** _(user's decision)_. This slice delivers the Storage policies, the database function, the web app's server-side code and the tests. The upload widget belongs to slice 07 (setup) and the replace button to slice 08 (settings). There is still no profile screen, and slice 07 waits for steps 2 and 3 of the preferences and eligibility work. This slice doesn't depend on those steps.
- **Who builds what** _(user's decision)_. The user builds the database and web-app side. The engine changes (see [Engine changes](#engine-changes-the-teammate)) go to the teammate, as part of step 2 of the [preferences and eligibility plan](../plans/2026-11-05-preferences-and-eligibility.md), so that two people never edit `modules/users` at the same time.

## Goals

- The web app, as the signed-in user and without the service-role key, can upload a profile's resume, replace it and download it.
- A profile can only ever point at a file in its owner's own folder for that profile.
- No user can read, list, write, overwrite or delete another user's files, and the two-user harness proves it.
- Replacing a resume leaves exactly one file in the profile's folder, even after failed attempts. Files younger than 15 minutes, which may be uploads still in flight, are left for the next upload's cleanup. _(my call)_

## Non-goals

- Any UI. That's slices 07 and 08.
- Removing a resume without replacing it. Once a profile has a resume it always has one. _(my call)_
- Building, rendering, tailoring or parsing resumes.
- More than one resume per profile, and version history.
- A background sweep for orphaned files. Cleanup on the next upload (below) is enough for now. _(my call)_

## Anti-goals

- A profile pointing at, or a user reaching, another user's file.
- Resume contents or filenames in logs, error messages, or public or long-lived URLs.
- Holding the service-role key in the web app. `apps/web/src/no-service-role.spec.ts` keeps enforcing this.

## Constraints

- **Vercel limits request and response bodies to 4.5 MB**, and the cap is 5 MiB. So the PDF can't be sent through a Next.js server action or route handler in either direction. The browser uploads to and downloads from Storage directly, with the user's session. _(my call, forced by the limit)_
- The Prisma contract is the only schema source. Storage policies, the bucket row and the function go in hand-written Prisma migrations, the same as the sign-up trigger. There is no `supabase/migrations` folder.
- The web app talks to Supabase through `supabase-js` as the signed-in user.

## Path layout and bucket

- Bucket `resumes`, private, `file_size_limit` 5 MiB, `allowed_mime_types = ['application/pdf']`.
- **The bucket is created by a migration**, which inserts the row into `storage.buckets` and updates it if it already exists. Then every environment, production included, gets the same limits without a manual step, and the engine's startup `ensureBucket` can go. `supabase/config.toml` keeps its matching entry for the local stack. Its comment, which says the engine writes with the service role, gets updated. Locally, `supabase start` creates the bucket from `config.toml` before migrations run, so the two must state the same limits. A test asserts the bucket row's limits. _(my call)_
- **Migrations must run as `postgres`** (a direct or session-pooler connection), because only that role can create policies on `storage.objects` and write `storage.buckets` on Supabase Cloud. The CI and shared-dev migration paths already connect this way. Slice 09 makes it a requirement for production. _(my call)_
- Object key: `<userId>/<profileId>/<uuid>.pdf`. The uuid is new for every upload. The user's filename is never part of the path.

## Storage policies (on `storage.objects`, bucket `resumes` only)

Here, "own folder" means the first path segment is `auth.uid()` and the second is the id of a profile that user owns (in any state).

| Action                       | Allowed when                                                                                                                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SELECT` (download, list)    | in the user's own folder                                                                                                                                                                                                  |
| `INSERT` (upload)            | in the user's own folder, and the key has the layout above                                                                                                                                                                |
| `UPDATE` (overwrite, upsert) | never                                                                                                                                                                                                                     |
| `DELETE`                     | in the user's own folder, and no **published** profile's `resumeKey` equals the object's key. A published profile never points at a missing file. A draft's live file can be deleted, which draft deletion needs (below). |

There are no other buckets or policies for `authenticated`. `anon` gets nothing.

**Size unit:** 5 MiB (5,242,880 bytes) everywhere: the bucket, the browser check and the server check. _(my call)_

## The swap function

`set_profile_resume(profile_id uuid, key text, filename text, sha256 text)` is a `SECURITY DEFINER` function with `search_path = ''`. It is the only way a user can write the resume columns. Users still have no column grants on them, and `profile-freeze.db.spec.ts` keeps proving that. The function:

1. Requires the caller to own the profile, in any state.
2. Requires `key` to be `<auth.uid()>/<profile_id>/<uuid>.pdf` and to exist in `storage.objects` in bucket `resumes`.
3. Takes the size from the object's Storage metadata, not from the caller.
4. Sets `resumeKey`, `resumeFilename` (the caller's filename, cleaned the same way as the engine's `safeFilename`, used only as the download name), `resumeSizeBytes` and `resumeUploadedAt = now()`. It sets `resumeSha256` from the `sha256` argument, which the server action computes (see below).
5. Returns the previous `resumeKey`, or null.

The function locks the profile row, so two uploads running at once end with one winner and no dangling pointer.

**The hash and the PDF check can be bypassed, and that's accepted.** A user who calls the function directly can skip the server action, so they can store a declared-PDF file that isn't really a PDF, with a false hash, in their own profile. That affects only their own data. The bucket still enforces the size and the declared type. Phase 3 has to check the file again before sending it (see [Notes for later phases](#notes-for-later-phases)). _(my call)_

## Web app flows (server-side code in `apps/web`)

These are server actions and helpers with tests. Slices 07 and 08 call them from their UI.

**Upload or replace**

1. The browser checks the file (declared type PDF, at most 5 MiB) for a quick error message, then uploads it with the user's session to `<userId>/<profileId>/<uuid>.pdf`. The browser generates the uuid. A helper builds the key, so the client never assembles paths itself.
2. A server action `confirmResume(profileId, key, filename)`:
   - downloads the object as the user, checks that it starts with `%PDF-` and is at most 5 MiB, and computes its SHA-256. If a check fails, it deletes the object and returns a validation error.
   - calls `set_profile_resume`.
   - deletes every other object in `<userId>/<profileId>/`, the previous file included. This also clears files left behind by earlier failed or abandoned uploads. A failed delete is only a warning, and the next upload retries it.
3. It returns the new resume metadata (filename, size, upload time).

**Download**

A browser-side helper downloads the profile's current `resumeKey` with `supabase-js` `download()` using the user's session. It then saves the file under `resumeFilename` from memory. No URL is created, so the filename never appears in a URL, and the file doesn't pass through Vercel. _(my call; a signed URL with a download name would put the filename in the URL.)_

**Draft deletion**

The web app can delete a draft profile directly (RLS allows it), but nothing would then delete the profile's file. Once the row is gone, the folder no longer counts as the user's own folder. Supabase also blocks deleting Storage objects from SQL. So a helper `deleteDraftProfile(profileId)` works in this order:

1. List and delete every object in `<userId>/<profileId>/`. The delete policy allows this for a draft.
2. Delete the row. RLS limits this to drafts, so a profile published in between keeps its row. Its file would then be gone, so the helper re-checks the state first and stops if the profile is no longer a draft.

If step 2 fails, the draft is left pointing at a missing file. That's harmless: drafts are never sent, and the next upload replaces the pointer. Slices 07 and 08 must delete drafts only through this helper. Deleting a published profile stays an engine action. _(my call)_

**Errors and logging**

User-facing errors are plain: not a PDF, too large, upload failed, try again. Logs may include the profile id and the Storage error code, never the filename or the file's contents.

## Tests

In `apps/db-tests`, with the two-user harness:

- A can upload, list, download and delete (when unreferenced) in A's own folder.
- A can't download, list, upload into, overwrite or delete anything in B's folder.
- A can't upload into `<A>/<B's profileId>/` or into a path with the wrong layout.
- No one can overwrite (`upsert`) an object, including their own.
- A can't delete the file a published profile of theirs points at, and can delete a draft's.
- The bucket row has the agreed limits.
- `set_profile_resume` refuses: another user's profile, a key in B's folder, a key for a different profile, a key with the wrong layout, and a key with no object. It accepts A's own valid key on a draft **and on a published profile**, and takes the size from Storage.
- Users still can't write the resume columns directly (the existing freeze tests).
- The bucket refuses a non-PDF declared type and a file over 5 MiB.

In `apps/web`, unit tests for the server actions and helpers: the signature check, cleanup of the folder after a swap, deleting the object when the check fails, the order of `deleteDraftProfile` and its stop on a published profile, and no filename in logs.

## Engine changes (the teammate)

These are part of step 2 of the preferences and eligibility plan. That plan's step-2 tasks don't mention resumes yet, so this slice's plan adds them to it as a new task, and the teammate is told. _(my call)_ Until they land, the engine's temporary endpoints can still write or delete resumes, bypassing the policies. They sit behind admin Basic auth and are being removed, so that window is accepted. _(my call)_

- Remove `ResumeController`, along with the upload, download and delete methods of `ResumeService` and their DTOs and tests.
- Keep deleting the resume files when the engine deletes a profile (`deleteProfile`) and in `removeAllFor`. The engine deletes published profiles, so this stays. Delete every object under the profile's folder, not only `resumeKey`.
- Remove `ensureBucket` from startup now that a migration creates the bucket. Keep `STORAGE_RESUMES_BUCKET`.
- The engine's own "drafts only" resume rule goes away with the endpoints.

Until this lands, the engine's endpoints still work, and the two paths don't conflict: both use the same layout, and the engine bypasses the policies.

## Notes for later phases

- **Phase 3:** before sending, the engine re-checks that the file starts with `%PDF-`, computes its SHA-256 at send time, and records that hash and the filename with each application. Users can replace resumes on published profiles, and old files aren't kept, so the hash is the record of what went out. A missing file at send time fails closed: the application is not sent.
- **Multiple resumes per role (after the MVP):** the per-profile folder layout already allows several files under one profile. The change would be in what points at them.

## Roadmap docs to update in the same PR

- `06-resume-storage.md`: link this spec. Correct "What already exists": users have no grants on the resume columns, and the profile-freeze tests check that; the engine allows changes on drafts only; the bucket is defined in `supabase/config.toml` and created by the engine on startup. Record the decisions above, and change "Done when" to the backend-only version.
- Phase README: under "Published profiles are frozen", add the resume exception. In "Resume", note that a resume can be replaced at any time. Mark "Preference fields" in "Open, to settle before slice 07" as settled by the preferences and eligibility spec.
- `07-guided-setup-ui.md`: add a resume upload step that uses this slice's actions. Draft deletion goes through `deleteDraftProfile`. Depends on steps 2 and 3 of the preferences and eligibility work, which set the final column names.
- `08-edit-preferences-ui.md`: replacing the resume works on published profiles too, and draft deletion goes through `deleteDraftProfile`. Same dependency.
- `09-hosted-launch.md`: production runs `db:seed`, which fills the ISO language and currency tables, and checks that the migration created the `resumes` bucket with its limits.

## Left to the builder

- The exact SQL for the policies and the function. Policy names follow the existing pattern.
- Whether the browser upload uses `supabase-js` `upload` directly or a signed upload URL from a server action. Either is fine if the policies hold. Direct upload is simpler.
- Module layout inside `apps/web/src/lib`.

## Done when

The web app's server-side code can upload, replace and download a profile's resume as the signed-in user, on drafts and published profiles. Each profile's folder holds one file after a replace. The isolation harness proves no other user can read, list, overwrite, delete or point at it.
