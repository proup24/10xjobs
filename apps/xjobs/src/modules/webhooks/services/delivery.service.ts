import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  buildMatchPayload,
  buildTestPayload,
  type WebhookPayloadV1,
} from '../payload/build';
import {
  type ClaimedDelivery,
  WebhooksRepository,
} from '../repositories/webhooks.repository';
import { send } from '../sender/send';

/** What the delivery step reads from the environment. */
export interface WebhookSettings {
  /** `WEB_APP_URL`, for the payload's links; null when unset. */
  webAppUrl: string | null;
}
export const WEBHOOK_SETTINGS = Symbol('WEBHOOK_SETTINGS');
/** The POST itself; `send` unless a test replaces it. */
export const WEBHOOK_SENDER = Symbol('WEBHOOK_SENDER');
/** The clock; `new Date()` unless a test replaces it. */
export const WEBHOOK_CLOCK = Symbol('WEBHOOK_CLOCK');

/**
 * `delivered`, `retry` (pending again on its backoff) and `failed` (gave up) follow a send.
 * Nothing was sent for the rest: `skipped` (the webhook is off or gone, or the match was
 * deleted), `busy` (another row of the webhook is sending), `held` (the webhook is failing and
 * this row waits behind its oldest one), `gone` (the row is gone, not pending or not due).
 */
export type DeliveryResult =
  | 'delivered'
  | 'retry'
  | 'failed'
  | 'skipped'
  | 'busy'
  | 'held'
  | 'gone';

/** Only the host is logged: a webhook URL's path and query may carry tokens. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'invalid url';
  }
}

/** Sends one webhook delivery and records the outcome on its row. */
@Injectable()
export class DeliveryService {
  private readonly logger = new Logger(DeliveryService.name);

  constructor(
    private readonly repo: WebhooksRepository,
    @Inject(WEBHOOK_SETTINGS) private readonly settings: WebhookSettings,
    @Optional() @Inject(WEBHOOK_SENDER) private readonly sender = send,
    @Optional()
    @Inject(WEBHOOK_CLOCK)
    private readonly now: () => Date = () => new Date(),
  ) {}

  async deliver(deliveryId: string): Promise<DeliveryResult> {
    const claim = await this.repo.claim(deliveryId, this.now());
    if (claim === null) return 'gone';
    if (claim === 'skip') return 'skipped';
    if (claim === 'busy' || claim === 'held') return claim;
    const { delivery, webhook } = claim;

    let payload = delivery.payload;
    if (payload === null) {
      const built = await this.build(delivery);
      // The match was deleted before the first attempt: nothing to send.
      if (!built) {
        await this.repo.skip(delivery.id, 'match deleted', this.now());
        return 'skipped';
      }
      // Send what was stored, so every attempt sends the same bytes.
      payload = await this.repo.savePayload(delivery.id, built);
      if (payload === null) return 'gone';
    }

    const result = await this.sender({
      url: webhook.url,
      body: JSON.stringify(payload),
      secret: webhook.secret,
      deliveryId: delivery.id,
      event: delivery.kind === 'test' ? 'test' : 'match.qualified',
      now: this.now(),
    });
    if (result.ok) {
      await this.repo.recordSuccess(delivery.id, result.status, this.now());
      return 'delivered';
    }
    const record = await this.repo.recordFailure(
      delivery.id,
      result,
      this.now(),
    );
    if (record.outcome === 'gone') return 'gone';
    const host = hostOf(webhook.url);
    this.logger.warn(
      `Webhook delivery ${delivery.id} to ${host} failed on attempt ${delivery.attempts}: ${result.error}` +
        (record.outcome === 'failed' ? '; giving up' : '') +
        (record.disabled ? `; webhook ${webhook.id} turned off` : ''),
    );
    return record.outcome;
  }

  /** The body for the row's first attempt; null when its match is gone. */
  private async build(
    delivery: ClaimedDelivery,
  ): Promise<WebhookPayloadV1 | null> {
    const ctx = {
      deliveryId: delivery.id,
      createdAt: delivery.createdAt,
      webAppUrl: this.settings.webAppUrl,
    };
    if (delivery.kind === 'test') {
      const [sample, labels] = await Promise.all([
        this.repo.latestQualifiedForUser(delivery.userId),
        this.repo.loadLabels(),
      ]);
      return buildTestPayload(sample, labels, ctx);
    }
    const input = await this.repo.loadPayloadInput(delivery.id);
    if (!input) return null;
    return buildMatchPayload(input, await this.repo.loadLabels(), ctx);
  }
}
