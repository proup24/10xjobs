# 06: Resume storage

## Goal

Each profile stores one resume PDF that Phase 3 sends with applications as it is. The engine already does this through its own resume endpoint and the service-role key; this slice moves it to the web app, protected by Storage policies.

## What already exists (on `main`)

- Resume columns on `Profile`: `resumeKey`, `resumeFilename`, `resumeSizeBytes`, `resumeSha256`, `resumeUploadedAt`.
- A private bucket (`resumes`), PDF checks (content type and the `%PDF-` signature), a 5 MB cap, and the old file deleted after a replacement is saved, all in the engine's resume service.

## In scope

- Storage policies on the private bucket: a user can read, write and delete only under their own `<userId>/` folder. Path layout: `<userId>/<profileId>/<uuid>.pdf`. The user's filename is never part of the path.
- Upload, replace and download from the web app, as the signed-in user.
- The same file checks as the engine: PDF only, 5 MB cap.
- Updating the resume columns on the profile after an upload.
- Storage access added to the isolation harness: A can't read, overwrite or list B's files.
- Removing the engine's resume endpoints once the web app covers them.

## Out of scope

- Building, rendering or tailoring resumes. Tailoring per job comes after the MVP.
- More than one resume per profile.
- Version history. Phase 3 records which file went out with each application.
- Parsing the PDF's text. If Phase 2 or 3 needs the text, that phase extracts it.

## Locked

- One PDF per profile, replaced on upload, no old versions kept.
- Resumes are personal data. They live only in the private bucket and are never logged or exposed through public URLs.

## For the slice spec

- Whether a published profile's resume can be replaced, given that published profiles are otherwise frozen.
- Where the file checks run: in a Next.js server action that uploads as the user, in the bucket's settings (allowed MIME types, size limit), or both.
- Download through short-lived signed URLs or proxied through the app.
- How the old file is removed on replace, given the upload and the column update are two steps.

## Done when

A user can upload, replace and download a profile's resume from the web app, and the isolation harness proves no other user can reach it.
