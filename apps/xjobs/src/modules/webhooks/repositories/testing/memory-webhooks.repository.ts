import type { Labels } from '@xjobs/database/matches';
import { WEBHOOK_CONFIG } from '../../config/webhooks.config';
import type { PayloadInput } from '../../payload/build';
import {
  type Claim,
  type FailureRecord,
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
}

const byAge = (a: MemoryDelivery, b: MemoryDelivery) =>
  a.createdAt.getTime() - b.createdAt.getTime() ||
  (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** In-memory WebhooksRepository for unit tests, with the same rules as the SQL one. */
export class MemoryWebhooksRepository extends WebhooksRepository {
  inputs = new Map<string, PayloadInput>();
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

  loadPayloadInput(deliveryId: string): Promise<PayloadInput | null> {
    return Promise.resolve(this.inputs.get(deliveryId) ?? null);
  }

  loadLabels(): Promise<Labels> {
    return Promise.resolve(this.labels);
  }

  latestQualifiedForUser(userId: string): Promise<PayloadInput | null> {
    return Promise.resolve(this.samples.get(userId) ?? null);
  }

  private head(webhookId: string): MemoryDelivery | undefined {
    return [...this.deliveries.values()]
      .filter((d) => d.webhookId === webhookId && d.status === 'pending')
      .sort(byAge)[0];
  }

  async claim(deliveryId: string, now: Date): Promise<Claim> {
    const d = this.deliveries.get(deliveryId);
    if (!d || d.status !== 'pending') return null;
    const w = this.webhooks.get(d.webhookId);
    if (!w || !w.enabled) {
      d.status = 'skipped';
      d.updatedAt = now;
      return 'skip';
    }
    const busy = [...this.deliveries.values()].some(
      (o) => o.webhookId === w.id && o.status === 'sending' && o.id !== d.id,
    );
    if (busy) return 'busy';
    if (w.consecutiveFailures > 0 && this.head(w.id)?.id !== d.id)
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

  async savePayload(id: string, payload: unknown): Promise<unknown> {
    const d = this.deliveries.get(id);
    if (!d || d.status !== 'sending') return null;
    // Stored as JSON, like the jsonb column.
    d.payload = JSON.parse(JSON.stringify(payload));
    return d.payload;
  }

  async skip(id: string, reason: string, now: Date): Promise<void> {
    const d = this.deliveries.get(id);
    if (!d || d.status !== 'sending') return;
    d.status = 'skipped';
    d.lastError = reason.slice(0, WEBHOOK_CONFIG.maxErrorChars);
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
    w.consecutiveFailures += 1;
    w.lastFailureAt = now;
    const disabled =
      w.enabled && w.consecutiveFailures >= WEBHOOK_CONFIG.autoDisableAfter;
    if (disabled) {
      w.enabled = false;
      w.disabledReason = 'failing';
    }
    return { outcome: delay === null ? 'failed' : 'retry', disabled };
  }

  async listDue(now: Date, limit: number): Promise<string[]> {
    return [...this.deliveries.values()]
      .filter((d) => {
        if (d.status !== 'pending' || d.nextAttemptAt.getTime() > now.getTime())
          return false;
        const w = this.webhooks.get(d.webhookId);
        if (!w) return false;
        return (
          !w.enabled ||
          w.consecutiveFailures === 0 ||
          this.head(w.id)?.id === d.id
        );
      })
      .sort(byAge)
      .slice(0, limit)
      .map((d) => d.id);
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
