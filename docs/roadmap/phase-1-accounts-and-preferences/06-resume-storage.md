# 06: Resume storage

Spec: [Resume storage](../../superpowers/specs/2026-11-06-resume-storage-design.md).

## Goal

Each profile stores one resume PDF that Phase 4 sends with applications as it is. The engine already does this through its own resume endpoints and the service-role key; this slice moves it to the web app, acting as the signed-in user and protected by Storage policies and a database function.

## What already exists (on `main`)

- Resume columns on `Profile`: `resumeKey`, `resumeFilename`, `resumeSizeBytes`, `resumeSha256`, `resumeUploadedAt`. Users have no grants on them; `profile-freeze.db.spec.ts` proves it.
- A private `resumes` bucket, defined in `supabase/config.toml` (5 MiB, PDF only) and created by the engine on startup (`ensureBucket`).
- The engine's resume service: PDF checks (content type and the `%PDF-` signature), a 5 MB cap, drafts only, the old file deleted after a replacement is saved, and files deleted with their profile.
- The web app has no service-role key, and `no-service-role.spec.ts` keeps it that way.

## In scope

- Storage policies: a user can read, upload and delete only under `<userId>/<profileId>/` for profiles they own; no overwrites; a published profile's live file can't be deleted. Path layout: `<userId>/<profileId>/<uuid>.pdf`. The user's filename is never part of the path.
- The bucket created by a migration, with its limits.
- A database function that is the only way to set the resume columns, and checks the file is the caller's.
- The web app's server-side code to upload, replace and download as the signed-in user, and to delete a draft with its files. The browser uploads to and downloads from Storage directly, because of Vercel's 4.5 MB body limit.
- Storage access added to the isolation harness.
- The engine's resume endpoints removed, by the teammate in step 2 of the preferences and eligibility plan.

## Out of scope

- Any UI: the upload step is slice 07's and the replace button slice 08's.
- Removing a resume without replacing it.
- Building, rendering, tailoring or parsing resumes. Tailoring per job comes after the MVP.
- More than one resume per profile, and version history.

## Locked

- One PDF per profile, replaced on upload, no old versions kept.
- A resume can be replaced at any time, on published profiles too. It's the one exception to the profile freeze.
- Resumes are personal data. They live only in the private bucket and are never logged or exposed through public URLs.
- Backend only; the database and web-app side is the user's, the engine side the teammate's.

## Done when

The web app's server-side code can upload, replace and download a profile's resume as the signed-in user, on drafts and published profiles, and the isolation harness proves no other user can read, list, overwrite, delete or point at it.
