import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database';
import type { DatabaseTransaction } from '@xjobs/database';
import type { DismissReason } from '@xjobs/database/enums';

/** The webhook a callback names, with the secret its signature is checked against. */
export interface CallbackWebhook {
  id: string;
  userId: string;
  secret: string;
}

/** A parsed feedback body: what the user did with a job the webhook sent. */
export type Feedback =
  | { jobId: string; status: 'applied' }
  | {
      jobId: string;
      status: 'dismissed';
      reason?: DismissReason;
      note?: string;
    };

/** The answer to one logged callback; `jobId` is the merge root that was decided. */
export type CallbackResult =
  | { result: 'ok' }
  | { result: 'saved'; jobId: string }
  | {
      result: 'already_decided';
      jobId: string;
      decision: 'applied' | 'dismissed' | 'expired';
    }
  | { result: 'not_matched' }
  | { result: 'invalid'; error: string };

/** What an authenticated callback asked for. */
export type CallbackRequest =
  | { type: 'ping' }
  | { type: 'invalid'; error: string }
  | { type: 'feedback'; feedback: Feedback };

/** The callback log and the decisions a receiver's feedback writes. */
export abstract class CallbacksRepository {
  /** null when no webhook has this id (any state). */
  abstract findWebhook(id: string): Promise<CallbackWebhook | null>;
  /**
   * One transaction: inserts the log row (type from `request`, `result` from the outcome),
   * then applies feedback. Returns 'replay' when (webhookId, signature) already exists; nothing is written then.
   */
  abstract record(
    webhook: CallbackWebhook,
    signature: string,
    request: CallbackRequest,
    at: Date,
  ): Promise<CallbackResult | 'replay'>;
}

const UUID = 'pg/uuid@1';
const TEXT = 'pg/text@1';
const BOOL = 'pg/bool@1';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class PrismaCallbacksRepository extends CallbacksRepository {
  constructor(private readonly database: DatabaseService) {
    super();
  }

  private get db() {
    return this.database.db;
  }

  async findWebhook(id: string): Promise<CallbackWebhook | null> {
    // A malformed id names no webhook; casting it would throw.
    if (!UUID_PATTERN.test(id)) return null;
    const { raw } = this.db;
    const [row] = await this.db.query(
      raw.sql`SELECT id, "userId", secret FROM webhooks WHERE id = ${id}::uuid`
        .returnsRow({ id: UUID, userId: UUID, secret: TEXT })
        .build(),
    );
    return row
      ? {
          id: row.id as string,
          userId: row.userId as string,
          secret: row.secret as string,
        }
      : null;
  }

  async record(
    webhook: CallbackWebhook,
    signature: string,
    request: CallbackRequest,
    at: Date,
  ): Promise<CallbackResult | 'replay'> {
    const t = at.toISOString();
    return this.db.transaction(async (tx) => {
      const { raw } = tx;
      const sent = request.type === 'feedback' ? request.feedback.jobId : '';
      // The log row comes first, before any feedback is applied. Only the (webhookId,
      // signature) constraint is absorbed: a re-sent request inserts nothing and goes no further.
      const [logged] = await tx.query(
        raw.sql`INSERT INTO webhook_callbacks
            (id, "userId", "webhookId", "receivedAt", type, "jobId", result, signature,
             "createdAt", "updatedAt")
          VALUES (${randomUUID()}::uuid, ${webhook.userId}::uuid, ${webhook.id}::uuid,
            ${t}::timestamptz, ${request.type}::text, NULLIF(${sent}::text, '')::uuid,
            ${initialResult(request)}::text, ${signature}::text, ${t}::timestamptz, ${t}::timestamptz)
          ON CONFLICT ON CONSTRAINT "webhook_callbacks_webhookId_signature_key" DO NOTHING
          RETURNING id`
          .returnsRow({ id: UUID })
          .build(),
      );
      if (!logged) return 'replay';
      if (request.type === 'ping') return { result: 'ok' };
      if (request.type === 'invalid')
        return { result: 'invalid', error: request.error };

      const result = await this.applyFeedback(
        tx,
        webhook.userId,
        request.feedback,
        t,
      );
      await tx.query(
        raw.sql`UPDATE webhook_callbacks SET result = ${result.result}::text, "updatedAt" = now()
          WHERE id = ${logged.id as string}::uuid
          RETURNING id`
          .returnsRow({ id: UUID })
          .build(),
      );
      return result;
    });
  }

  /** Decides the merge root of the job, once: an existing decision is never changed. */
  private async applyFeedback(
    tx: DatabaseTransaction,
    userId: string,
    feedback: Feedback,
    t: string,
  ): Promise<CallbackResult> {
    const { raw } = tx;
    // mergedIntoId followed at most 10 steps, as in loadPayloadInput.
    const [root] = await tx.query(
      raw.sql`WITH RECURSIVE chain AS (
          SELECT j.id, j."mergedIntoId", 0 AS depth
          FROM normalized_jobs j WHERE j.id = ${feedback.jobId}::uuid
          UNION ALL
          SELECT n.id, n."mergedIntoId", chain.depth + 1
          FROM chain JOIN normalized_jobs n ON n.id = chain."mergedIntoId"
          WHERE chain.depth < 10
        ), root AS (
          SELECT id FROM chain ORDER BY depth DESC LIMIT 1
        )
        SELECT root.id, EXISTS (
            SELECT 1 FROM job_matches m
            WHERE m."userId" = ${userId}::uuid AND m."jobId" = root.id) AS matched
        FROM root`
        .returnsRow({ id: UUID, matched: BOOL })
        .build(),
    );
    if (!root || !root.matched) return { result: 'not_matched' };
    const jobId = root.id as string;
    const dismissed = feedback.status === 'dismissed';
    const reason = dismissed ? (feedback.reason ?? '') : '';
    const note = dismissed ? (feedback.note ?? '') : '';

    // Two tries: a decision cleared between the conflict and the read lets the second insert in.
    for (let attempt = 0; attempt < 2; attempt++) {
      // A dismissal keeps a snapshot of the user's matches on the job, as saveDecision does.
      const [inserted] = await tx.query(
        raw.sql`INSERT INTO job_decisions
            (id, "userId", "jobId", status, reason, note, "matchSnapshot", source,
             "decidedAt", "createdAt", "updatedAt")
          SELECT ${randomUUID()}::uuid, ${userId}::uuid, ${jobId}::uuid, ${feedback.status}::text,
            NULLIF(${reason}::text, ''), NULLIF(${note}::text, ''),
            CASE WHEN ${dismissed}::boolean THEN (
              SELECT COALESCE(jsonb_agg(jsonb_build_object(
                  'profileId', m."profileId", 'outcome', m.outcome,
                  'matcherVersion', m."matcherVersion", 'checks', m.checks)
                ORDER BY m."profileId"), '[]'::jsonb)
              FROM job_matches m
              WHERE m."userId" = ${userId}::uuid AND m."jobId" = ${jobId}::uuid)
            END,
            'webhook', ${t}::timestamptz, ${t}::timestamptz, ${t}::timestamptz
          ON CONFLICT ("userId", "jobId") DO NOTHING
          RETURNING id`
          .returnsRow({ id: UUID })
          .build(),
      );
      if (inserted) return { result: 'saved', jobId };
      const [existing] = await tx.query(
        raw.sql`SELECT status FROM job_decisions
          WHERE "userId" = ${userId}::uuid AND "jobId" = ${jobId}::uuid`
          .returnsRow({ status: TEXT })
          .build(),
      );
      if (existing)
        return {
          result: 'already_decided',
          jobId,
          decision: existing.status as 'applied' | 'dismissed' | 'expired',
        };
    }
    throw new Error(`Decision on job ${jobId} neither inserted nor found`);
  }
}

/** The log row's result as inserted; feedback overwrites it with the outcome before commit. */
function initialResult(request: CallbackRequest): CallbackResult['result'] {
  if (request.type === 'ping') return 'ok';
  if (request.type === 'invalid') return 'invalid';
  return 'not_matched';
}
