import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database';
import type { DatabaseTransaction } from '@xjobs/database';
import type { Labels } from '@xjobs/database/matches';
import { WEBHOOK_CONFIG } from '../config/webhooks.config';
import type { PayloadInput } from '../payload/build';

/** A delivery claimed for one send: its status is now `sending`, `attempts` counts this one. */
export interface ClaimedDelivery {
  id: string;
  userId: string;
  webhookId: string;
  kind: 'match' | 'test';
  attempts: number;
  /** The body stored at the first attempt; null until then. */
  payload: unknown;
  createdAt: Date;
}

/** Where the claimed delivery goes. */
export interface DeliveryTarget {
  id: string;
  url: string;
  secret: string;
}

/**
 * `skip`: the webhook is off or gone, and the row is now `skipped`. `busy`: another row of
 * the webhook is sending. `held`: the webhook is failing and this row is not its oldest
 * pending one. null: the row is gone, not pending, or not due.
 */
export type Claim =
  | { delivery: ClaimedDelivery; webhook: DeliveryTarget }
  | 'skip'
  | 'busy'
  | 'held'
  | null;

/** `gone`: the row was deleted or is no longer the one this send claimed; nothing was written. */
export interface FailureRecord {
  outcome: 'retry' | 'failed' | 'gone';
  /** This failure reached the limit and turned the webhook off. */
  disabled: boolean;
}

/** Every read and write of webhook deliveries. */
export abstract class WebhooksRepository {
  /** The delivery's match, profile and job as they are now; null when the delivery or its match is gone. */
  abstract loadPayloadInput(deliveryId: string): Promise<PayloadInput | null>;
  /** The code to label lookups the check wording needs, cached for 10 minutes. */
  abstract loadLabels(): Promise<Labels>;
  /** The user's most recently decided qualified match, for a test delivery's sample. */
  abstract latestQualifiedForUser(userId: string): Promise<PayloadInput | null>;
  /**
   * In one transaction, with the webhook row locked: skips the row when the webhook is off,
   * refuses it when busy or held back, and otherwise marks it `sending` and counts the attempt.
   */
  abstract claim(deliveryId: string, now: Date): Promise<Claim>;
  /** Stores a sending row's body; returns it as stored (what every attempt sends), or null when the row is gone. */
  abstract savePayload(id: string, payload: unknown): Promise<unknown>;
  /** A sending row that can't be sent (its match was deleted) becomes `skipped`. */
  abstract skip(id: string, reason: string, now: Date): Promise<void>;
  /** `delivered`; resets the webhook's failures and makes its other pending rows due now. */
  abstract recordSuccess(
    id: string,
    statusCode: number,
    now: Date,
  ): Promise<void>;
  /** Back to `pending` on the next delay, or `failed` at the last attempt; counts the webhook's failure. */
  abstract recordFailure(
    id: string,
    result: { status: number | null; error: string },
    now: Date,
  ): Promise<FailureRecord>;
  /** Ids of due pending rows, oldest first; of a failing webhook only its oldest pending row. */
  abstract listDue(now: Date, limit: number): Promise<string[]>;
  /** Rows `sending` for longer than `stuckSendingMs` go back to `pending`, due now; returns how many. */
  abstract recoverStuck(now: Date): Promise<number>;
  /** Clears old match rows' payload and error, and deletes old test rows. */
  abstract applyRetention(
    now: Date,
  ): Promise<{ cleared: number; deleted: number }>;
}

/** The wait after a failed attempt number `attempts` (1-based); null when it was the last one. */
export function retryDelayMs(attempts: number): number | null {
  if (attempts >= WEBHOOK_CONFIG.maxAttempts) return null;
  const delays = WEBHOOK_CONFIG.retryDelaysMs;
  return delays[Math.min(attempts, delays.length) - 1];
}

type Raw = DatabaseTransaction['raw'];

const UUID = 'pg/uuid@1';
const TEXT = 'pg/text@1';
const BOOL = 'pg/bool@1';
const JSONB = 'pg/jsonb@1';
const TIMESTAMPTZ = 'pg/timestamptz-date@1';
const NUMERIC = 'pg/numeric@1';
const INT = 'pg/int4@1';

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

  async claim(deliveryId: string, now: Date): Promise<Claim> {
    const at = now.toISOString();
    return this.db.transaction(async (tx): Promise<Claim> => {
      const { raw } = tx;
      // The webhook row first: it serialises every claim and outcome of this webhook.
      const [webhook] = await tx.query(
        raw.sql`SELECT w.id, w.url, w.secret, w.enabled, w."consecutiveFailures"
          FROM webhooks w
          WHERE w.id = (SELECT "webhookId" FROM webhook_deliveries WHERE id = ${deliveryId}::uuid)
          FOR UPDATE`
          .returnsRow({
            id: UUID,
            url: TEXT,
            secret: TEXT,
            enabled: BOOL,
            consecutiveFailures: INT,
          })
          .build(),
      );
      const [row] = await tx.query(
        raw.sql`SELECT id, "userId", "webhookId", kind, status, "nextAttemptAt", "createdAt"
          FROM webhook_deliveries WHERE id = ${deliveryId}::uuid FOR UPDATE`
          .returnsRow({
            id: UUID,
            userId: UUID,
            webhookId: UUID,
            kind: TEXT,
            status: TEXT,
            nextAttemptAt: TIMESTAMPTZ,
            createdAt: TIMESTAMPTZ,
          })
          .build(),
      );
      if (!row || row.status !== 'pending') return null;
      if (!webhook || !webhook.enabled) {
        await tx.query(
          raw.sql`UPDATE webhook_deliveries SET status = 'skipped', "updatedAt" = ${at}::timestamptz
            WHERE id = ${deliveryId}::uuid RETURNING id`
            .returnsRow({ id: UUID })
            .build(),
        );
        return 'skip';
      }
      const [sending] = await tx.query(
        raw.sql`SELECT id FROM webhook_deliveries
          WHERE "webhookId" = ${webhook.id as string}::uuid AND status = 'sending'
            AND id <> ${deliveryId}::uuid
          LIMIT 1`
          .returnsRow({ id: UUID })
          .build(),
      );
      if (sending) return 'busy';
      if ((webhook.consecutiveFailures as number) > 0) {
        const [head] = await tx.query(
          raw.sql`SELECT id FROM webhook_deliveries
            WHERE "webhookId" = ${webhook.id as string}::uuid AND status = 'pending'
            ORDER BY "createdAt", id LIMIT 1`
            .returnsRow({ id: UUID })
            .build(),
        );
        if (head?.id !== deliveryId) return 'held';
      }
      if ((row.nextAttemptAt as Date).getTime() > now.getTime()) return null;
      const [claimed] = await tx.query(
        raw.sql`UPDATE webhook_deliveries
          SET status = 'sending', attempts = attempts + 1, "updatedAt" = ${at}::timestamptz
          WHERE id = ${deliveryId}::uuid
          RETURNING attempts, payload`
          .returnsRow({ attempts: INT, payload: JSONB })
          .build(),
      );
      return {
        delivery: {
          id: row.id as string,
          userId: row.userId as string,
          webhookId: row.webhookId as string,
          kind: row.kind as 'match' | 'test',
          attempts: claimed.attempts as number,
          payload: claimed.payload ?? null,
          createdAt: row.createdAt as Date,
        },
        webhook: {
          id: webhook.id as string,
          url: webhook.url as string,
          secret: webhook.secret as string,
        },
      };
    });
  }

  async savePayload(id: string, payload: unknown): Promise<unknown> {
    const { raw } = this.db;
    const [row] = await this.db.query(
      raw.sql`UPDATE webhook_deliveries SET payload = ${JSON.stringify(payload)}::jsonb, "updatedAt" = now()
        WHERE id = ${id}::uuid AND status = 'sending'
        RETURNING payload`
        .returnsRow({ payload: JSONB })
        .build(),
    );
    return row ? row.payload : null;
  }

  async skip(id: string, reason: string, now: Date): Promise<void> {
    const { raw } = this.db;
    await this.db.query(
      raw.sql`UPDATE webhook_deliveries
        SET status = 'skipped', "lastError" = ${reason.slice(0, WEBHOOK_CONFIG.maxErrorChars)}::text,
          "updatedAt" = ${now.toISOString()}::timestamptz
        WHERE id = ${id}::uuid AND status = 'sending'
        RETURNING id`
        .returnsRow({ id: UUID })
        .build(),
    );
  }

  /** Locks the delivery's webhook row, the same order as `claim`; null when either is gone. */
  private async lockWebhookOf(tx: DatabaseTransaction, id: string) {
    const [webhook] = await tx.query(
      tx.raw.sql`SELECT w.id, w.enabled, w."consecutiveFailures"
        FROM webhooks w
        WHERE w.id = (SELECT "webhookId" FROM webhook_deliveries WHERE id = ${id}::uuid)
        FOR UPDATE`
        .returnsRow({ id: UUID, enabled: BOOL, consecutiveFailures: INT })
        .build(),
    );
    return webhook
      ? {
          id: webhook.id as string,
          enabled: webhook.enabled as boolean,
          consecutiveFailures: webhook.consecutiveFailures as number,
        }
      : null;
  }

  async recordSuccess(
    id: string,
    statusCode: number,
    now: Date,
  ): Promise<void> {
    const at = now.toISOString();
    await this.db.transaction(async (tx) => {
      const { raw } = tx;
      const webhook = await this.lockWebhookOf(tx, id);
      if (!webhook) return;
      const [row] = await tx.query(
        raw.sql`UPDATE webhook_deliveries
          SET status = 'delivered', "deliveredAt" = ${at}::timestamptz,
            "lastStatusCode" = ${statusCode}::int, "lastError" = NULL, "updatedAt" = ${at}::timestamptz
          WHERE id = ${id}::uuid AND status = 'sending'
          RETURNING id`
          .returnsRow({ id: UUID })
          .build(),
      );
      if (!row) return;
      await tx.query(
        raw.sql`UPDATE webhooks
          SET "consecutiveFailures" = 0, "lastSuccessAt" = ${at}::timestamptz, "updatedAt" = now()
          WHERE id = ${webhook.id}::uuid
          RETURNING id`
          .returnsRow({ id: UUID })
          .build(),
      );
      // Release the rows held back while failing; the sweep sends them oldest first.
      await tx.query(
        raw.sql`UPDATE webhook_deliveries
          SET "nextAttemptAt" = ${at}::timestamptz, "updatedAt" = ${at}::timestamptz
          WHERE "webhookId" = ${webhook.id}::uuid AND status = 'pending'
            AND "nextAttemptAt" > ${at}::timestamptz
          RETURNING id`
          .returnsRow({ id: UUID })
          .build(),
      );
    });
  }

  async recordFailure(
    id: string,
    result: { status: number | null; error: string },
    now: Date,
  ): Promise<FailureRecord> {
    const at = now.toISOString();
    return this.db.transaction(async (tx): Promise<FailureRecord> => {
      const { raw } = tx;
      const gone: FailureRecord = { outcome: 'gone', disabled: false };
      const webhook = await this.lockWebhookOf(tx, id);
      if (!webhook) return gone;
      const [row] = await tx.query(
        raw.sql`SELECT attempts FROM webhook_deliveries
          WHERE id = ${id}::uuid AND status = 'sending' FOR UPDATE`
          .returnsRow({ attempts: INT })
          .build(),
      );
      if (!row) return gone;
      const delay = retryDelayMs(row.attempts as number);
      const next =
        delay === null ? null : new Date(now.getTime() + delay).toISOString();
      await tx.query(
        raw.sql`UPDATE webhook_deliveries
          SET status = ${delay === null ? 'failed' : 'pending'}::text,
            "nextAttemptAt" = COALESCE(NULLIF(${next ?? ''}::text, '')::timestamptz, "nextAttemptAt"),
            "lastStatusCode" = NULLIF(${result.status === null ? '' : String(result.status)}::text, '')::int,
            "lastError" = ${result.error.slice(0, WEBHOOK_CONFIG.maxErrorChars)}::text,
            "updatedAt" = ${at}::timestamptz
          WHERE id = ${id}::uuid
          RETURNING id`
          .returnsRow({ id: UUID })
          .build(),
      );
      const failures = webhook.consecutiveFailures + 1;
      const disabled =
        webhook.enabled && failures >= WEBHOOK_CONFIG.autoDisableAfter;
      await tx.query(
        raw.sql`UPDATE webhooks
          SET "consecutiveFailures" = ${failures}::int, "lastFailureAt" = ${at}::timestamptz,
            enabled = enabled AND NOT ${disabled}::boolean,
            "disabledReason" = CASE WHEN ${disabled}::boolean THEN 'failing' ELSE "disabledReason" END,
            "updatedAt" = now()
          WHERE id = ${webhook.id}::uuid
          RETURNING id`
          .returnsRow({ id: UUID })
          .build(),
      );
      return { outcome: delay === null ? 'failed' : 'retry', disabled };
    });
  }

  async listDue(now: Date, limit: number): Promise<string[]> {
    const { raw } = this.db;
    const rows = await this.db.query(
      raw.sql`SELECT d.id FROM webhook_deliveries d
        JOIN webhooks w ON w.id = d."webhookId"
        WHERE d.status = 'pending' AND d."nextAttemptAt" <= ${now.toISOString()}::timestamptz
          AND (NOT w.enabled OR w."consecutiveFailures" = 0
            OR d.id = (SELECT h.id FROM webhook_deliveries h
              WHERE h."webhookId" = d."webhookId" AND h.status = 'pending'
              ORDER BY h."createdAt", h.id LIMIT 1))
        ORDER BY d."createdAt", d.id
        LIMIT ${limit}::int`
        .returnsRow({ id: UUID })
        .build(),
    );
    return rows.map((r) => r.id as string);
  }

  async recoverStuck(now: Date): Promise<number> {
    const { raw } = this.db;
    const at = now.toISOString();
    const before = new Date(
      now.getTime() - WEBHOOK_CONFIG.stuckSendingMs,
    ).toISOString();
    const rows = await this.db.query(
      raw.sql`UPDATE webhook_deliveries
        SET status = 'pending', "nextAttemptAt" = ${at}::timestamptz, "updatedAt" = ${at}::timestamptz
        WHERE status = 'sending' AND "updatedAt" < ${before}::timestamptz
        RETURNING id`
        .returnsRow({ id: UUID })
        .build(),
    );
    return rows.length;
  }

  async applyRetention(
    now: Date,
  ): Promise<{ cleared: number; deleted: number }> {
    const { raw } = this.db;
    const before = new Date(
      now.getTime() - WEBHOOK_CONFIG.retentionDays * 86_400_000,
    ).toISOString();
    // Match rows stay as the "already sent" record; only finished ones are slimmed.
    const cleared = await this.db.query(
      raw.sql`UPDATE webhook_deliveries SET payload = NULL, "lastError" = NULL, "updatedAt" = now()
        WHERE kind = 'match' AND status IN ('delivered', 'failed', 'skipped')
          AND "createdAt" < ${before}::timestamptz
          AND (payload IS NOT NULL OR "lastError" IS NOT NULL)
        RETURNING id`
        .returnsRow({ id: UUID })
        .build(),
    );
    const deleted = await this.db.query(
      raw.sql`DELETE FROM webhook_deliveries
        WHERE kind = 'test' AND "createdAt" < ${before}::timestamptz
        RETURNING id`
        .returnsRow({ id: UUID })
        .build(),
    );
    return { cleared: cleared.length, deleted: deleted.length };
  }
}
