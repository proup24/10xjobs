# 06: Resume storage

## Goal

Each workspace stores one resume PDF that Phase 3 sends with applications as it is.

## In scope

- A private Supabase Storage bucket with policies that match workspace RLS.
- Upload, replace and download for the workspace's own file only.
- File checks: PDF only, with a size limit.
- Metadata on the workspace (file name, size, uploaded-at) so the app can show what's on file.
- Storage access added to the isolation harness: A can't read, overwrite or list B's file.

## Out of scope

- Building, rendering or tailoring resumes. Tailoring per job comes after the MVP.
- More than one resume per workspace.
- Version history. My call: Phase 3 records which file went out with each application.
- Parsing the PDF's text. If Phase 2 or 3 needs the text, that phase extracts it.

## Locked

- One PDF per workspace, replaced on upload, no old versions kept.
- Resumes are personal data. They live only in the private bucket and are never logged or exposed through public URLs.

## For the slice spec

- The size limit, and how strictly PDFs are checked (extension, content type, file signature).
- Download through short-lived signed URLs or proxied through the app.
- The storage path layout (for example, keyed by workspace id).
- Whether the old file is deleted at once on replace or cleaned up later.

## Done when

A user can upload, replace and download their resume, and the isolation harness proves no other workspace can reach it.
