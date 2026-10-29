import type { SupabaseClient } from '@supabase/supabase-js';

/** The part of `supabase.storage` the engine uses. */
export type StorageClient = Pick<
  SupabaseClient['storage'],
  'from' | 'getBucket' | 'createBucket'
>;

export type StorageFailure = {
  message: string;
  status?: number;
  statusCode?: string;
  code?: string;
};
