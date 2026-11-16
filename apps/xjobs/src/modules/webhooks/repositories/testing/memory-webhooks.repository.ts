import type { Labels } from '@xjobs/database/matches';
import { WEBHOOK_CONFIG } from '../../config/webhooks.config';
import type { PayloadInput } from '../../payload/build';
import {
  type Claim,
  type FailureRecord,
  type LoadedMatch,
  retryDelayMs,
  WebhooksRepository,
} from '../webhooks.repository';

export interface MemoryWebhook {
  id: string;
  userId: string;
  url: string;
  secret: string;
  enabled: boolean;
  disabledReason: 'user' | 'failing' | null;
  consecutiveFailures: number;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
}

export interface MemoryDelivery {
  id: string;
  userId: string;
  webhookId: string;
  kind: 'match' | 'test';
  status: 'pending' | 'sending' | 'delivered' | 'failed' | 'skipped';
  attempts: number;
  nextAttemptAt: Date;
  lastStatusCode: number | null;
  lastError: string | null;
  deliveredAt: Date | null;
  payload: unknown;
  createdAt: Date;
  updatedAt: Date;
  /** Match rows: what the stand-in rule of `loadPayloadInput` reads. Unset in most tests. */
  profileId?: string | null;
  jobId?: string | null;
  /** null: the match was deleted, so `inputs` holds the merge root's match (a stand-in). */
  matchId?: string | null;
}

const byAge = (a: MemoryDelivery, b: MemoryDelivery) =>
  a.createdAt.getTime() - b.createdAt.getTime() ||
  (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** In-memory WebhooksRepository for unit tests, with the same rules as the SQL one. */
export class MemoryWebhooksRepository extends WebhooksRepository {
  /** Each match delivery's match as `loadPayloadInput` resolves it, by delivery id. */
  inputs = new Map<string, PayloadInput>();
  /** That match's outcome, by delivery id; `qualified` when unset. */
  outcomes = new Map<string, LoadedMatch['outcome']>();
  /** Each merged job's merge root, by job id; a job missing here is its own root. */
  roots = new Map<string, string>();
  samples = new Map<string, PayloadInput>();
  webhooks = new Map<string, MemoryWebhook>();
  deliveries = new Map<string, MemoryDelivery>();
  labels: Labels = {
    positions: [],
    seniorities: [],
    techs: [],
    countries: [],
    regions: [],
    cities: [],
    languages: [],
    currencies: [],
    contractTypes: [],
  };

  addWebhook(
    w: Pick<MemoryWebhook, 'id' | 'userId' | 'url' | 'secret'> &
      Partial<MemoryWebhook>,
  ): MemoryWebhook {
    const webhook: MemoryWebhook = {
      enabled: true,
      disabledReason: null,
      consecutiveFailures: 0,
      lastSuccessAt: null,
      lastFailureAt: null,
      ...w,
    };
    this.webhooks.set(webhook.id, webhook);
    return webhook;
  }

  /** A pending row, due at its creation unless `nextAttemptAt` says otherwise. */
  addDelivery(
    d: Pick<
      MemoryDelivery,
      'id' | 'userId' | 'webhookId' | 'kind' | 'createdAt'
    > &
      Partial<MemoryDelivery>,
  ): MemoryDelivery {
    const delivery: MemoryDelivery = {
      status: 'pending',
      attempts: 0,
      nextAttemptAt: d.createdAt,
      lastStatusCode: null,
      lastError: null,
      deliveredAt: null,
      payload: null,
      updatedAt: d.createdAt,
      ...d,
    };
    this.deliveries.set(delivery.id, delivery);
    return delivery;
  }

  loadPayloadInput(deliveryId: string): Promise<LoadedMatch | null> {
    const d = this.deliveries.get(deliveryId);
    // A stand-in is refused when another live match delivery of the profile has the same root.
    if (d?.matchId === null && d.jobId) {
      const root = (job: string) => this.roots.get(job) ?? job;
      const target = root(d.jobId);
      const taken = [...this.deliveries.values()].some(
        (o) =>
          o.id !== d.id &&
          o.kind === 'match' &&
          o.status !== 'skipped' &&
          o.profileId === d.profileId &&
          o.jobId != null &&
          root(o.jobId) === target,
      );
      if (taken) return Promise.resolve(null);
    }
    const input = this.inputs.get(deliveryId);
    return Promise.resolve(
      input
        ? { input, outcome: this.outcomes.get(deliveryId) ?? 'qualified' }
        : null,
    );
  }

  loadLabels(): Promise<Labels> {
    return Promise.resolve(this.labels);
  }

  latestQualifiedForUser(userId: string): Promise<PayloadInput | null> {
    return Promise.resolve(this.samples.get(userId) ?? null);
  }

  /** The webhook's oldest pending match row: the only one that goes while it is failing. */
  private matchHead(webhookId: string): MemoryDelivery | undefined {
    return [...this.deliveries.values()]
      .filter(
        (d) =>
          d.webhookId === webhookId &&
          d.status === 'pending' &&
          d.kind === 'match',
      )
      .sort(byAge)[0];
  }

  async claim(deliveryId: string, now: Date): Promise<Claim> {
    const d = this.deliveries.get(deliveryId);
    if (!d || d.status !== 'pending') return null;
    const w = this.webhooks.get(d.webhookId);
    if (!w || !w.enabled) {
      d.status = 'skipped';
      d.updatedAt = now;
      return { skipped: true, webhookId: d.webhookId };
    }
    const busy = [...this.deliveries.values()].some(
      (o) => o.webhookId === w.id && o.status === 'sending' && o.id !== d.id,
    );
    if (busy) return 'busy';
    if (
      d.kind === 'match' &&
      w.consecutiveFailures > 0 &&
      this.matchHead(w.id)?.id !== d.id
    )
      return 'held';
    if (d.nextAttemptAt.getTime() > now.getTime()) return null;
    d.status = 'sending';
    d.attempts += 1;
    d.updatedAt = now;
    return {
      delivery: {
        id: d.id,
        userId: d.userId,
        webhookId: d.webhookId,
        kind: d.kind,
        attempts: d.attempts,
        payload: d.payload,
        createdAt: d.createdAt,
      },
      webhook: { id: w.id, url: w.url, secret: w.secret },
    };
  }

  async savePayload(id: string, payload: unknown, now: Date): Promise<unknown> {
    const d = this.deliveries.get(id);
    if (!d || d.status !== 'sending') return null;
    // Stored as JSON, like the jsonb column.
    d.payload = JSON.parse(JSON.stringify(payload));
    d.updatedAt = now;
    return d.payload;
  }

  async skip(id: string, reason: string, now: Date): Promise<void> {
    const d = this.deliveries.get(id);
    if (!d || d.status !== 'sending') return;
    d.status = 'skipped';
    d.lastError = reason.slice(0, WEBHOOK_CONFIG.maxErrorChars);
    d.updatedAt = now;
  }

  async release(id: string, now: Date): Promise<void> {
    const d = this.deliveries.get(id);
    if (!d || d.status !== 'sending') return;
    d.status = 'pending';
    d.attempts = Math.max(d.attempts - 1, 0);
    d.nextAttemptAt = new Date(now.getTime() + WEBHOOK_CONFIG.retryDelaysMs[0]);
    d.updatedAt = now;
  }

  async recordSuccess(
    id: string,
    statusCode: number,
    now: Date,
  ): Promise<void> {
    const d = this.deliveries.get(id);
    const w = d && this.webhooks.get(d.webhookId);
    if (!d || !w || d.status !== 'sending') return;
    Object.assign(d, {
      status: 'delivered',
      deliveredAt: now,
      lastStatusCode: statusCode,
      lastError: null,
      updatedAt: now,
    });
    if (d.kind === 'test') return;
    w.consecutiveFailures = 0;
    w.lastSuccessAt = now;
    for (const o of this.deliveries.values())
      if (
        o.webhookId === w.id &&
        o.status === 'pending' &&
        o.nextAttemptAt.getTime() > now.getTime()
      ) {
        o.nextAttemptAt = now;
        o.updatedAt = now;
      }
  }

  async recordFailure(
    id: string,
    result: { status: number | null; error: string },
    now: Date,
  ): Promise<FailureRecord> {
    const d = this.deliveries.get(id);
    const w = d && this.webhooks.get(d.webhookId);
    if (!d || !w || d.status !== 'sending')
      return { outcome: 'gone', disabled: false };
    const delay = retryDelayMs(d.attempts);
    d.status = delay === null ? 'failed' : 'pending';
    if (delay !== null) d.nextAttemptAt = new Date(now.getTime() + delay);
    d.lastStatusCode = result.status;
    d.lastError = result.error.slice(0, WEBHOOK_CONFIG.maxErrorChars);
    d.updatedAt = now;
    const outcome = delay === null ? 'failed' : 'retry';
    if (d.kind === 'test') return { outcome, disabled: false };
    w.consecutiveFailures += 1;
    w.lastFailureAt = now;
    const disabled =
      w.enabled && w.consecutiveFailures >= WEBHOOK_CONFIG.autoDisableAfter;
    if (disabled) {
      w.enabled = false;
      w.disabledReason = 'failing';
    }
    return { outcome, disabled };
  }

  /** The webhook's head, by the rule `listDue` documents; undefined when it has none due. */
  private dueHead(webhookId: string, now: Date): MemoryDelivery | undefined {
    const w = this.webhooks.get(webhookId);
    if (!w) return undefined;
    const failing = w.enabled && w.consecutiveFailures > 0;
    const matchHead = this.matchHead(webhookId);
    return [...this.deliveries.values()]
      .filter(
        (d) =>
          d.webhookId === webhookId &&
          d.status === 'pending' &&
          d.nextAttemptAt.getTime() <= now.getTime() &&
          (d.kind === 'test' || !failing || d.id === matchHead?.id),
      )
      .sort(byAge)[0];
  }

  async listDue(now: Date, limit: number): Promise<string[]> {
    return [...this.webhooks.keys()]
      .map((id) => this.dueHead(id, now))
      .filter((d): d is MemoryDelivery => d !== undefined)
      .sort(byAge)
      .slice(0, limit)
      .map((d) => d.id);
  }

  async nextDue(webhookId: string, now: Date): Promise<string | null> {
    return this.dueHead(webhookId, now)?.id ?? null;
  }

  async recoverStuck(now: Date): Promise<number> {
    const before = now.getTime() - WEBHOOK_CONFIG.stuckSendingMs;
    let n = 0;
    for (const d of this.deliveries.values())
      if (d.status === 'sending' && d.updatedAt.getTime() < before) {
        d.status = 'pending';
        d.nextAttemptAt = now;
        d.updatedAt = now;
        n += 1;
      }
    return n;
  }

  async applyRetention(
    now: Date,
  ): Promise<{ cleared: number; deleted: number }> {
    const before = now.getTime() - WEBHOOK_CONFIG.retentionDays * 86_400_000;
    let cleared = 0;
    let deleted = 0;
    for (const d of [...this.deliveries.values()]) {
      if (d.createdAt.getTime() >= before) continue;
      if (d.kind === 'test') {
        this.deliveries.delete(d.id);
        deleted += 1;
      } else if (
        ['delivered', 'failed', 'skipped'].includes(d.status) &&
        (d.payload !== null || d.lastError !== null)
      ) {
        d.payload = null;
        d.lastError = null;
        cleared += 1;
      }
    }
    return { cleared, deleted };
  }
}
