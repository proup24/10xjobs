import { randomUUID } from 'node:crypto';
import type { DatabaseTransaction } from '@xjobs/database';
import type { NormalizedCompany } from '../normalize';

const UUID = 'pg/uuid@1';

/**
 * Writes a LinkedIn company seen at `seenAt` and returns its id. Seen times
 * only widen; the facts are overwritten only by an observation at least as
 * recent as the stored one, so rebuilding an older job never rolls the
 * company back. One statement, so concurrent ingest cannot race. Raw SQL
 * takes non-null scalars only, so the company travels as one JSON value.
 */
export async function upsertCompany(
  tx: DatabaseTransaction,
  company: NormalizedCompany,
  seenAt: Date,
): Promise<string> {
  const at = seenAt.toISOString();
  const [row] = await tx.query(
    tx.raw.sql`WITH c AS (SELECT ${JSON.stringify(company)}::jsonb AS d)
      INSERT INTO companies
        (id, "linkedinId", "universalName", name, "linkedinUrl", website,
         "employeeCount", "employeeCountMin", "employeeCountMax",
         industries, specialities, description, "headquartersCountryCode",
         "firstSeenAt", "lastSeenAt")
      SELECT ${randomUUID()}::uuid, d->>'linkedinId', d->>'universalName',
        d->>'name', d->>'linkedinUrl', d->>'website',
        (d->>'employeeCount')::int, (d->>'employeeCountMin')::int,
        (d->>'employeeCountMax')::int,
        ARRAY(SELECT jsonb_array_elements_text(d->'industries')),
        ARRAY(SELECT jsonb_array_elements_text(d->'specialities')),
        d->>'description', d->>'headquartersCountryCode',
        ${at}::timestamptz, ${at}::timestamptz
      FROM c
      ON CONFLICT ("linkedinId") DO UPDATE SET
        "universalName" = CASE WHEN EXCLUDED."lastSeenAt" >= companies."lastSeenAt" THEN EXCLUDED."universalName" ELSE companies."universalName" END,
        name = CASE WHEN EXCLUDED."lastSeenAt" >= companies."lastSeenAt" THEN EXCLUDED.name ELSE companies.name END,
        "linkedinUrl" = CASE WHEN EXCLUDED."lastSeenAt" >= companies."lastSeenAt" THEN EXCLUDED."linkedinUrl" ELSE companies."linkedinUrl" END,
        website = CASE WHEN EXCLUDED."lastSeenAt" >= companies."lastSeenAt" THEN EXCLUDED.website ELSE companies.website END,
        "employeeCount" = CASE WHEN EXCLUDED."lastSeenAt" >= companies."lastSeenAt" THEN EXCLUDED."employeeCount" ELSE companies."employeeCount" END,
        "employeeCountMin" = CASE WHEN EXCLUDED."lastSeenAt" >= companies."lastSeenAt" THEN EXCLUDED."employeeCountMin" ELSE companies."employeeCountMin" END,
        "employeeCountMax" = CASE WHEN EXCLUDED."lastSeenAt" >= companies."lastSeenAt" THEN EXCLUDED."employeeCountMax" ELSE companies."employeeCountMax" END,
        industries = CASE WHEN EXCLUDED."lastSeenAt" >= companies."lastSeenAt" THEN EXCLUDED.industries ELSE companies.industries END,
        specialities = CASE WHEN EXCLUDED."lastSeenAt" >= companies."lastSeenAt" THEN EXCLUDED.specialities ELSE companies.specialities END,
        description = CASE WHEN EXCLUDED."lastSeenAt" >= companies."lastSeenAt" THEN EXCLUDED.description ELSE companies.description END,
        "headquartersCountryCode" = CASE WHEN EXCLUDED."lastSeenAt" >= companies."lastSeenAt" THEN EXCLUDED."headquartersCountryCode" ELSE companies."headquartersCountryCode" END,
        "firstSeenAt" = least(companies."firstSeenAt", EXCLUDED."firstSeenAt"),
        "lastSeenAt" = greatest(companies."lastSeenAt", EXCLUDED."lastSeenAt"),
        "updatedAt" = now()
      RETURNING id`
      .returnsRow({ id: UUID })
      .build(),
  );
  if (!row) throw new Error('company upsert returned no row');
  return row.id as string;
}
