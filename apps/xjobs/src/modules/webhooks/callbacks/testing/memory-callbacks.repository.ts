import {
  type CallbackRequest,
  type CallbackResult,
  type CallbackWebhook,
  CallbacksRepository,
  type Feedback,
} from '../callbacks.repository';

/** One logged callback, as `webhook_callbacks` stores it. */
export interface MemoryCallback {
  userId: string;
  webhookId: string;
  receivedAt: Date;
  type: CallbackRequest['type'];
  /** The job id the receiver sent (not the merge root); null for ping and invalid. */
  jobId: string | null;
  result: CallbackResult['result'];
  signature: string;
}

export interface MemoryDecision {
  userId: string;
  jobId: string;
  status: 'applied' | 'dismissed' | 'expired';
  reason: string | null;
  note: string | null;
  source: 'app' | 'webhook';
  decidedAt: Date;
}

/** In-memory CallbacksRepository for unit tests, with the same rules as the SQL one. */
export class MemoryCallbacksRepository extends CallbacksRepository {
  webhooks = new Map<string, CallbackWebhook>();
  /** The log, in insert order. */
  callbacks: MemoryCallback[] = [];
  decisions: MemoryDecision[] = [];
  /** `${userId}:${jobId}` of every job the user has a match on. */
  matches = new Set<string>();
  /** Each merged job's merge root, by job id; a job missing here is its own root. */
  roots = new Map<string, string>();

  addWebhook(webhook: CallbackWebhook): CallbackWebhook {
    this.webhooks.set(webhook.id, webhook);
    return webhook;
  }

  addMatch(userId: string, jobId: string): void {
    this.matches.add(`${userId}:${jobId}`);
  }

  async findWebhook(id: string): Promise<CallbackWebhook | null> {
    return this.webhooks.get(id) ?? null;
  }

  async record(
    webhook: CallbackWebhook,
    signature: string,
    request: CallbackRequest,
    at: Date,
  ): Promise<CallbackResult | 'replay'> {
    if (
      this.callbacks.some(
        (c) => c.webhookId === webhook.id && c.signature === signature,
      )
    )
      return 'replay';
    const result: CallbackResult =
      request.type === 'ping'
        ? { result: 'ok' }
        : request.type === 'invalid'
          ? { result: 'invalid', error: request.error }
          : this.decide(webhook.userId, request.feedback, at);
    this.callbacks.push({
      userId: webhook.userId,
      webhookId: webhook.id,
      receivedAt: at,
      type: request.type,
      jobId: request.type === 'feedback' ? request.feedback.jobId : null,
      result: result.result,
      signature,
    });
    return result;
  }

  private decide(userId: string, feedback: Feedback, at: Date): CallbackResult {
    const jobId = this.roots.get(feedback.jobId) ?? feedback.jobId;
    if (!this.matches.has(`${userId}:${jobId}`))
      return { result: 'not_matched' };
    const existing = this.decisions.find(
      (d) => d.userId === userId && d.jobId === jobId,
    );
    if (existing)
      return { result: 'already_decided', jobId, decision: existing.status };
    const dismissed = feedback.status === 'dismissed';
    this.decisions.push({
      userId,
      jobId,
      status: feedback.status,
      reason: dismissed ? (feedback.reason ?? null) : null,
      note: dismissed ? feedback.note || null : null,
      source: 'webhook',
      decidedAt: at,
    });
    return { result: 'saved', jobId };
  }
}
