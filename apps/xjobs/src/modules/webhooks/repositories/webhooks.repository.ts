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

/** A match delivery's match as it is now, and that match's current outcome. */
export interface LoadedMatch {
  input: PayloadInput;
  outcome: 'qualified' | 'rejected' | 'review';
}

/** Where the claimed delivery goes. */
export interface DeliveryTarget {
  id: string;
  url: string;
  secret: string;
}

/**
 * `skipped`: the webhook is off or gone, and the row is now `skipped`. `busy`: another row of
 * the webhook is sending. `held`: the webhook is failing and this match row is not its oldest
 * pending match row (test rows are never held). null: the row is gone, not pending, or not due.
 */
export type Claim =
  | { delivery: ClaimedDelivery; webhook: DeliveryTarget }
  | { skipped: true; webhookId: string }
  | 'busy'
  | 'held'
  | null;

/** `gone`: the row was deleted or is no longer the one this send claimed; nothing was written. */
export interface FailureRecord {
  outcome: 'retry' | 'failed' | 'gone';
  /** This failure reached the limit and turned the webhook off. */
  disabled: boolean;
}

/** What one retention pass changed. */
export interface Retention {
  /** Old match rows whose payload and error were cleared. */
  cleared: number;
  /** Old test rows deleted. */
  deleted: number;
  /** `webhook_callbacks` rows received before the retention period, deleted. */
  callbacksDeleted: number;
}

/** Every read and write of webhook deliveries. */
export abstract class WebhooksRepository {
  /**
   * The delivery's match, profile and job as they are now. When the match was deleted
   * (`matchId` null, e.g. its job merged into another and the sweep removed the old match),
   * the profile's match on the root of the job's merge chain stands in, unless another match
   * delivery of the profile (not skipped) has a job with that root. null when the delivery is
   * gone, there is no such match, or that other delivery sends the job.
   */
  abstract loadPayloadInput(deliveryId: string): Promise<LoadedMatch | null>;
  /** The code to label lookups the check wording needs, cached for 10 minutes. */
  abstract loadLabels(): Promise<Labels>;
  /** The user's most recently decided qualified listing match, for a test delivery's sample. */
  abstract latestQualifiedForUser(userId: string): Promise<PayloadInput | null>;
  /**
   * In one transaction, with the webhook row locked: skips the row when the webhook is off,
   * refuses it when busy or held back, and otherwise marks it `sending` and counts the attempt.
   */
  abstract claim(deliveryId: string, now: Date): Promise<Claim>;
  /** Stores a sending row's body; returns it as stored (what every attempt sends), or null when the row is gone. */
  abstract savePayload(
    id: string,
    payload: unknown,
    now: Date,
  ): Promise<unknown>;
  /** A sending row that can't be sent (its match was deleted) becomes `skipped`. */
  abstract skip(id: string, reason: string, now: Date): Promise<void>;
  /**
   * A sending row whose send broke inside the engine (not the receiver) goes back to
   * `pending`: the attempt is given back, and it is due again after the first retry delay.
   */
  abstract release(id: string, now: Date): Promise<void>;
  /**
   * `delivered`. For a match row it also resets the webhook's failures and makes its other
   * pending rows due now; a test row touches only itself.
   */
  abstract recordSuccess(
    id: string,
    statusCode: number,
    now: Date,
  ): Promise<void>;
  /**
   * Back to `pending` on the next delay, or `failed` at the last attempt. A match row counts
   * the webhook's failure (and may turn it off); a test row touches only itself.
   */
  abstract recordFailure(
    id: string,
    result: { status: number | null; error: string },
    now: Date,
  ): Promise<FailureRecord>;
  /**
   * At most one row per webhook, its head, oldest first across webhooks. The head is the
   * oldest due pending row; while the webhook is failing (and enabled), its match rows other
   * than the oldest pending one are left out, so that one goes only once due. Test rows are
   * never held back. The send chain (`nextDue`) drains the rest.
   */
  abstract listDue(now: Date, limit: number): Promise<string[]>;
  /** The webhook's head by the same rule as `listDue`, or null. */
  abstract nextDue(webhookId: string, now: Date): Promise<string | null>;
  /** Rows `sending` for longer than `stuckSendingMs` go back to `pending`, due now; returns how many. */
  abstract recoverStuck(now: Date): Promise<number>;
  /** Clears old match rows' payload and error, and deletes old test rows and old callbacks. */
  abstract applyRetention(now: Date): Promise<Retention>;
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

/**
 * The columns of one match, its profile, job, company and facts, and for a post role its post
 * (`pj`) and the role's howToApply in the post's current post extraction (`pe`). `from`/`where`
 * pick which; `inputJoins` joins c, f, pj and pe onto j.
 */
const inputColumns = (raw: Raw) =>
  raw.sql`m.id AS "matchId", m.checks, m.unverified, m."stackScore",
  p.id AS "profileId", p.position,
  j.id AS "jobId", j.kind, j.title, COALESCE(j."companyName", c.name) AS "companyName",
  COALESCE(j."companyUrl", c.website, c."linkedinUrl") AS "companyUrl",
  j."postingUrl", j."applyUrl", j."postedAt", j."firstSeenAt", j."descriptionText",
  f.facts,
  pj."postingUrl" AS "postUrl", pj."postSources"->'sources' AS "postSources",
  (SELECT r.value->'howToApply'
     FROM jsonb_array_elements(CASE WHEN jsonb_typeof(pe.data->'roles') = 'array'
                                    THEN pe.data->'roles' ELSE '[]'::jsonb END) r(value)
    WHERE r.value->>'roleKey' = j."roleKey"
    LIMIT 1) AS "howToApply"`.returns(TEXT);

const inputJoins = (raw: Raw) =>
  raw.sql`LEFT JOIN companies c ON c.id = j."companyId"
  LEFT JOIN job_facts f ON f."jobId" = j.id
  LEFT JOIN normalized_jobs pj ON pj.id = j."parentJobId" AND j.kind = 'post_role'
  LEFT JOIN job_extractions pe ON pe.id = pj."currentExtractionId" AND pe."docType" = 'post'`.returns(
    TEXT,
  );

const INPUT_ROW = {
  matchId: UUID,
  checks: JSONB,
  unverified: BOOL,
  stackScore: NUMERIC,
  profileId: UUID,
  position: TEXT,
  jobId: UUID,
  kind: TEXT,
  title: TEXT,
  companyName: TEXT,
  companyUrl: TEXT,
  postingUrl: TEXT,
  applyUrl: TEXT,
  postedAt: TIMESTAMPTZ,
  firstSeenAt: TIMESTAMPTZ,
  descriptionText: TEXT,
  facts: JSONB,
  postUrl: TEXT,
  postSources: JSONB,
  howToApply: JSONB,
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
      kind: r.kind === 'post_role' ? 'post_role' : 'job',
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
    post:
      r.kind === 'post_role'
        ? {
            url: (r.postUrl as string | null) ?? null,
            sources: r.postSources ?? null,
            howToApply: r.howToApply ?? null,
          }
        : null,
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

  async loadPayloadInput(deliveryId: string): Promise<LoadedMatch | null> {
    const { raw } = this.db;
    // The match is the delivery's own, or, once that was deleted, the profile's match on the
    // root of the job's merge chain (mergedIntoId followed at most 10 steps, as in
    // webhook_enqueue_match), so a job merged before its first send still reaches the user.
    // No stand-in when another match delivery of the profile (not skipped) has a job with the
    // same root: that one sends the job, and two delivery ids would defeat the receiver's dedupe.
    const [row] = await this.db.query(
      raw.sql`WITH RECURSIVE dl AS (
          SELECT "trigger", "matchId", "profileId", "jobId" FROM webhook_deliveries
          WHERE id = ${deliveryId}::uuid AND kind = 'match'
        ), chain AS (
          SELECT j.id, j."mergedIntoId", 0 AS depth
          FROM normalized_jobs j JOIN dl ON j.id = dl."jobId"
          WHERE dl."matchId" IS NULL
          UNION ALL
          SELECT n.id, n."mergedIntoId", chain.depth + 1
          FROM chain JOIN normalized_jobs n ON n.id = chain."mergedIntoId"
          WHERE chain.depth < 10
        ), others AS (
          SELECT j.id, j."mergedIntoId", 0 AS depth
          FROM webhook_deliveries o
          JOIN dl ON o."profileId" = dl."profileId"
          JOIN normalized_jobs j ON j.id = o."jobId"
          WHERE dl."matchId" IS NULL AND o.kind = 'match' AND o.status <> 'skipped'
            AND o.id <> ${deliveryId}::uuid
          UNION ALL
          SELECT n.id, n."mergedIntoId", others.depth + 1
          FROM others JOIN normalized_jobs n ON n.id = others."mergedIntoId"
          WHERE others.depth < 10
        ), root AS (
          SELECT id FROM chain ORDER BY depth DESC LIMIT 1
        )
        SELECT dl."trigger", m.outcome, ${inputColumns(raw)}
        FROM dl
        JOIN job_matches m ON m.id = COALESCE(dl."matchId", (
          SELECT r.id FROM job_matches r
          WHERE r."profileId" = dl."profileId" AND r."jobId" = (SELECT id FROM root)
            -- Each other chain's last node (no next) is its root.
            AND NOT EXISTS (SELECT 1 FROM others
              WHERE others."mergedIntoId" IS NULL AND others.id = (SELECT id FROM root))))
        JOIN profiles p ON p.id = m."profileId"
        JOIN normalized_jobs j ON j.id = m."jobId"
        ${inputJoins(raw)}`
        .returnsRow({ trigger: TEXT, outcome: TEXT, ...INPUT_ROW })
        .build(),
    );
    return row
      ? {
          input: toInput(row, row.trigger as 'decision' | 'review'),
          outcome: row.outcome as LoadedMatch['outcome'],
        }
      : null;
  }

  async latestQualifiedForUser(userId: string): Promise<PayloadInput | null> {
    const { raw } = this.db;
    const [row] = await this.db.query(
      raw.sql`SELECT ${inputColumns(raw)}
        FROM job_matches m
        JOIN profiles p ON p.id = m."profileId"
        JOIN normalized_jobs j ON j.id = m."jobId"
        ${inputJoins(raw)}
        -- A test delivery samples a listing, never a post role.
        WHERE m."userId" = ${userId}::uuid AND m.outcome = 'qualified' AND j.kind = 'job'
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
      // The webhook row first: it serialises every claim and outcome of this webhook. NO KEY
      // UPDATE, so the deliveries' foreign key checks (KEY SHARE) on new rows don't wait.
      const [webhook] = await tx.query(
        raw.sql`SELECT w.id, w.url, w.secret, w.enabled, w."consecutiveFailures"
          FROM webhooks w
          WHERE w.id = (SELECT "webhookId" FROM webhook_deliveries WHERE id = ${deliveryId}::uuid)
          FOR NO KEY UPDATE`
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
        return { skipped: true, webhookId: row.webhookId as string };
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
      // Hold-back orders match rows only; a test goes past a failing head.
      if (row.kind === 'match' && (webhook.consecutiveFailures as number) > 0) {
        const [head] = await tx.query(
          raw.sql`SELECT id FROM webhook_deliveries
            WHERE "webhookId" = ${webhook.id as string}::uuid AND status = 'pending'
              AND kind = 'match'
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

  async savePayload(id: string, payload: unknown, now: Date): Promise<unknown> {
    const { raw } = this.db;
    const [row] = await this.db.query(
      raw.sql`UPDATE webhook_deliveries SET payload = ${JSON.stringify(payload)}::jsonb,
          "updatedAt" = ${now.toISOString()}::timestamptz
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

  async release(id: string, now: Date): Promise<void> {
    const { raw } = this.db;
    const at = now.toISOString();
    const next = new Date(
      now.getTime() + WEBHOOK_CONFIG.retryDelaysMs[0],
    ).toISOString();
    await this.db.query(
      raw.sql`UPDATE webhook_deliveries
        SET status = 'pending', attempts = GREATEST(attempts - 1, 0),
          "nextAttemptAt" = ${next}::timestamptz, "updatedAt" = ${at}::timestamptz
        WHERE id = ${id}::uuid AND status = 'sending'
        RETURNING id`
        .returnsRow({ id: UUID })
        .build(),
    );
  }

  /**
   * Locks the delivery's webhook row, the same order as `claim`; null when either is gone.
   * `test` is set for a test row, whose outcome never touches the webhook row.
   */
  private async lockWebhookOf(tx: DatabaseTransaction, id: string) {
    const [webhook] = await tx.query(
      tx.raw.sql`SELECT w.id, w.enabled, w."consecutiveFailures", d.kind
        FROM webhook_deliveries d
        JOIN webhooks w ON w.id = d."webhookId"
        WHERE d.id = ${id}::uuid
        FOR NO KEY UPDATE OF w`
        .returnsRow({
          id: UUID,
          enabled: BOOL,
          consecutiveFailures: INT,
          kind: TEXT,
        })
        .build(),
    );
    return webhook
      ? {
          id: webhook.id as string,
          enabled: webhook.enabled as boolean,
          consecutiveFailures: webhook.consecutiveFailures as number,
          test: webhook.kind === 'test',
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
      // A test proves nothing about match delivery order: no reset, no release.
      if (!row || webhook.test) return;
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
      const outcome = delay === null ? 'failed' : 'retry';
      // A test's failure doesn't count toward auto-disable.
      if (webhook.test) return { outcome, disabled: false };
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
      return { outcome, disabled };
    });
  }

  /** Each webhook's head (see `listDue`), optionally of one webhook only. */
  private heads(raw: Raw, now: Date, webhookId: string | null) {
    const at = now.toISOString();
    return raw.sql`SELECT h.id, h."createdAt" FROM (
        SELECT DISTINCT ON (d."webhookId") d.id, d."createdAt"
        FROM webhook_deliveries d
        JOIN webhooks w ON w.id = d."webhookId"
        WHERE d.status = 'pending' AND d."nextAttemptAt" <= ${at}::timestamptz
          AND (NULLIF(${webhookId ?? ''}::text, '') IS NULL
            OR d."webhookId" = NULLIF(${webhookId ?? ''}::text, '')::uuid)
          -- While failing (and on), only the oldest pending match row may go, once due;
          -- test rows are never held back.
          AND (d.kind = 'test' OR NOT (w.enabled AND w."consecutiveFailures" > 0)
            OR d.id = (SELECT o.id FROM webhook_deliveries o
              WHERE o."webhookId" = d."webhookId" AND o.status = 'pending' AND o.kind = 'match'
              ORDER BY o."createdAt", o.id LIMIT 1))
        ORDER BY d."webhookId", d."createdAt", d.id
      ) h`.returns(TEXT);
  }

  async listDue(now: Date, limit: number): Promise<string[]> {
    const { raw } = this.db;
    const rows = await this.db.query(
      raw.sql`SELECT id FROM (${this.heads(raw, now, null)}) due
        ORDER BY "createdAt", id
        LIMIT ${limit}::int`
        .returnsRow({ id: UUID })
        .build(),
    );
    return rows.map((r) => r.id as string);
  }

  async nextDue(webhookId: string, now: Date): Promise<string | null> {
    const { raw } = this.db;
    const [row] = await this.db.query(
      raw.sql`${this.heads(raw, now, webhookId)}`
        .returnsRow({ id: UUID, createdAt: TIMESTAMPTZ })
        .build(),
    );
    return row ? (row.id as string) : null;
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

  async applyRetention(now: Date): Promise<Retention> {
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
    const callbacks = await this.db.query(
      // The newest callback of each webhook stays: the Webhook page and the
      // activity signal read it, however old it is.
      raw.sql`DELETE FROM webhook_callbacks c
        WHERE c."receivedAt" < ${before}::timestamptz
          AND EXISTS (
            SELECT 1 FROM webhook_callbacks n
            WHERE n."webhookId" = c."webhookId"
              AND (n."receivedAt", n.id) > (c."receivedAt", c.id))
        RETURNING c.id`
        .returnsRow({ id: UUID })
        .build(),
    );
    return {
      cleared: cleared.length,
      deleted: deleted.length,
      callbacksDeleted: callbacks.length,
    };
  }
}
