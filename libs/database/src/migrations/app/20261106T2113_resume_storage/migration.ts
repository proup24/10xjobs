#!/usr/bin/env -S node
import type {
  Contract as End,
  Contract as Start,
} from '../../snapshots/1cfd25e269628885ca3ef263392ec32a0390667dcf7f74a7eabfc9c04de0cdd6/contract';
import endContract from '../../snapshots/1cfd25e269628885ca3ef263392ec32a0390667dcf7f74a7eabfc9c04de0cdd6/contract.json' with { type: 'json' };
import startContract from '../../snapshots/1cfd25e269628885ca3ef263392ec32a0390667dcf7f74a7eabfc9c04de0cdd6/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  rawSql,
} from '@prisma/orm-postgres/migration';

// NOTE: this migration changes no contract (same start and end hash), so the
// `resume-storage` invariant in ../refs/db.json decides whether it runs on a
// fresh database. Advancing the `db` ref writes `invariants: []`; re-add it.
// The `resumes` bucket and its Storage policies live here because the Prisma
// contract has no model for the `storage` schema.

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      // operationClass is 'data' because the contract does not change: the planner
      // rejects a same-hash migration with no data op.
      rawSql({
        id: 'storage.resumes_bucket_and_policies',
        invariantId: 'resume-storage',
        label: 'resumes bucket and per-user Storage policies',
        operationClass: 'data',
        target: {
          id: 'postgres',
          details: { schema: 'public', objectType: 'table', name: 'profiles' },
        },
        precheck: [],
        execute: [
          {
            description: 'create or update the private resumes bucket',
            sql: `INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('resumes', 'resumes', false, 5242880, '{application/pdf}')
ON CONFLICT (id) DO UPDATE SET
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;`,
          },
          {
            description:
              'resume_folder_is_own(): the folder is the caller and the profile is theirs',
            sql: `CREATE FUNCTION public.resume_folder_is_own(object_name text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT (storage.foldername(object_name))[1] = auth.uid()::text
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id::text = (storage.foldername(object_name))[2]
        AND p."userId" = auth.uid()
    );
$$;
REVOKE ALL ON FUNCTION public.resume_folder_is_own(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resume_folder_is_own(text) TO authenticated;`,
          },
          {
            description:
              'resume_key_is_own(): the key has the agreed layout and the folder is own',
            sql: `CREATE FUNCTION public.resume_key_is_own(object_name text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT object_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.pdf$'
    AND public.resume_folder_is_own(object_name);
$$;
REVOKE ALL ON FUNCTION public.resume_key_is_own(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resume_key_is_own(text) TO authenticated;`,
          },
          {
            description: 'users read and list their own profile folders',
            sql: `CREATE POLICY resumes_select_own ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'resumes' AND public.resume_folder_is_own(name));`,
          },
          {
            description:
              'users upload only well-formed keys in their own folders',
            sql: `CREATE POLICY resumes_insert_own ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'resumes' AND public.resume_key_is_own(name));`,
          },
          {
            description:
              'users delete their own files, except the live file of a published profile',
            sql: `CREATE POLICY resumes_delete_own ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'resumes'
    AND public.resume_folder_is_own(name)
    AND NOT EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p."resumeKey" = objects.name AND p.state = 'published'
    )
  );`,
          },
        ],
        postcheck: [],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
