import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database';
import type { DatabaseTransaction } from '@xjobs/database';
import type { Labels } from '@xjobs/database/matches';
import type { PayloadInput } from '../payload/build';

/** Every read the webhook payload needs. */
export abstract class WebhooksRepository {
  /** The delivery's match, profile and job as they are now; null when the delivery or its match is gone. */
  abstract loadPayloadInput(deliveryId: string): Promise<PayloadInput | null>;
  /** The code to label lookups the check wording needs, cached for 10 minutes. */
  abstract loadLabels(): Promise<Labels>;
  /** The user's most recently decided qualified match, for a test delivery's sample. */
  abstract latestQualifiedForUser(userId: string): Promise<PayloadInput | null>;
}

type Raw = DatabaseTransaction['raw'];

const UUID = 'pg/uuid@1';
const TEXT = 'pg/text@1';
const BOOL = 'pg/bool@1';
const JSONB = 'pg/jsonb@1';
const TIMESTAMPTZ = 'pg/timestamptz-date@1';
const NUMERIC = 'pg/numeric@1';

const LABELS_TTL_MS = 10 * 60_000;

/** The columns of one match, its profile, job, company and facts. `from`/`where` pick which. */
const inputColumns = (raw: Raw) =>
  raw.sql`m.id AS "matchId", m.checks, m.unverified, m."stackScore",
  p.id AS "profileId", p.position,
  j.id AS "jobId", j.title, COALESCE(j."companyName", c.name) AS "companyName",
  COALESCE(j."companyUrl", c.website, c."linkedinUrl") AS "companyUrl",
  j."postingUrl", j."applyUrl", j."postedAt", j."firstSeenAt", j."descriptionText",
  f.facts`.returns(TEXT);

const INPUT_ROW = {
  matchId: UUID,
  checks: JSONB,
  unverified: BOOL,
  stackScore: NUMERIC,
  profileId: UUID,
  position: TEXT,
  jobId: UUID,
  title: TEXT,
  companyName: TEXT,
  companyUrl: TEXT,
  postingUrl: TEXT,
  applyUrl: TEXT,
  postedAt: TIMESTAMPTZ,
  firstSeenAt: TIMESTAMPTZ,
  descriptionText: TEXT,
  facts: JSONB,
} as const;

type Row = Record<keyof typeof INPUT_ROW, unknown>;

function toInput(r: Row, trigger: 'decision' | 'review'): PayloadInput {
  return {
    profile: { id: r.profileId as string, position: r.position as string },
    match: {
      id: r.matchId as string,
      checks: r.checks,
      unverified: r.unverified as boolean,
      stackScore: r.stackScore === null ? null : Number(r.stackScore),
      trigger,
    },
    job: {
      id: r.jobId as string,
      title: (r.title as string | null) ?? null,
      companyName: (r.companyName as string | null) ?? null,
      companyUrl: (r.companyUrl as string | null) ?? null,
      postingUrl: r.postingUrl as string,
      applyUrl: (r.applyUrl as string | null) ?? null,
      postedAt: (r.postedAt as Date | null) ?? null,
      firstSeenAt: r.firstSeenAt as Date,
      descriptionText: (r.descriptionText as string | null) ?? null,
    },
    facts: r.facts ?? null,
  };
}

@Injectable()
export class PrismaWebhooksRepository extends WebhooksRepository {
  private labels: { at: number; value: Labels } | null = null;

  constructor(private readonly database: DatabaseService) {
    super();
  }

  private get db() {
    return this.database.db;
  }

  async loadPayloadInput(deliveryId: string): Promise<PayloadInput | null> {
    const { raw } = this.db;
    const [row] = await this.db.query(
      raw.sql`SELECT d."trigger", ${inputColumns(raw)}
        FROM webhook_deliveries d
        JOIN job_matches m ON m.id = d."matchId"
        JOIN profiles p ON p.id = m."profileId"
        JOIN normalized_jobs j ON j.id = m."jobId"
        LEFT JOIN companies c ON c.id = j."companyId"
        LEFT JOIN job_facts f ON f."jobId" = j.id
        WHERE d.id = ${deliveryId}::uuid AND d.kind = 'match'`
        .returnsRow({ trigger: TEXT, ...INPUT_ROW })
        .build(),
    );
    return row ? toInput(row, row.trigger as 'decision' | 'review') : null;
  }

  async latestQualifiedForUser(userId: string): Promise<PayloadInput | null> {
    const { raw } = this.db;
    const [row] = await this.db.query(
      raw.sql`SELECT ${inputColumns(raw)}
        FROM job_matches m
        JOIN profiles p ON p.id = m."profileId"
        JOIN normalized_jobs j ON j.id = m."jobId"
        LEFT JOIN companies c ON c.id = j."companyId"
        LEFT JOIN job_facts f ON f."jobId" = j.id
        WHERE m."userId" = ${userId}::uuid AND m.outcome = 'qualified'
        ORDER BY m."decidedAt" DESC, m.id DESC
        LIMIT 1`
        .returnsRow(INPUT_ROW)
        .build(),
    );
    return row ? toInput(row, 'decision') : null;
  }

  async loadLabels(): Promise<Labels> {
    const now = Date.now();
    if (this.labels && now - this.labels.at < LABELS_TTL_MS)
      return this.labels.value;
    const { raw } = this.db;
    const pairs = async (sql: ReturnType<Raw['sql']>) =>
      (
        await this.db.query(
          sql.returnsRow({ value: TEXT, label: TEXT }).build(),
        )
      ).map((r) => ({ value: r.value as string, label: r.label as string }));
    const [
      positions,
      seniorities,
      techs,
      countries,
      regions,
      languages,
      currencies,
      contractTypes,
      cityRows,
    ] = await Promise.all([
      pairs(raw.sql`SELECT code AS value, label FROM role_kinds`),
      pairs(raw.sql`SELECT code AS value, label FROM seniorities`),
      pairs(raw.sql`SELECT code AS value, label FROM tech_tags`),
      pairs(raw.sql`SELECT code AS value, label FROM countries`),
      pairs(raw.sql`SELECT code AS value, label FROM regions`),
      pairs(raw.sql`SELECT code AS value, label FROM iso_languages`),
      pairs(raw.sql`SELECT code AS value, label FROM iso_currencies`),
      pairs(raw.sql`SELECT code AS value, label FROM contract_types`),
      this.db.query(
        raw.sql`SELECT id, name, "countryCode" FROM cities`
          .returnsRow({ id: UUID, name: TEXT, countryCode: TEXT })
          .build(),
      ),
    ]);
    const countryLabel = new Map(countries.map((c) => [c.value, c.label]));
    const cities = cityRows.map((c) => ({
      value: c.id as string,
      label: `${c.name as string}, ${countryLabel.get(c.countryCode as string) ?? (c.countryCode as string)}`,
    }));
    const value: Labels = {
      positions,
      seniorities,
      techs,
      countries,
      regions,
      cities,
      languages,
      currencies,
      contractTypes,
    };
    this.labels = { at: now, value };
    return value;
  }
}
