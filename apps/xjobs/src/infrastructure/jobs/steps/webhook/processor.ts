import { UnrecoverableError } from 'bullmq';
import { z } from 'zod';
import {
  type DeliveryService,
  WEBHOOK_CONFIG,
  type WebhooksRepository,
} from 'src/modules/webhooks';
import type { WebhookEnqueuer } from '../match/processor';
import { WEBHOOK_SEND_JOB, WEBHOOK_SWEEP_JOB } from './queue.service';

const sendPayload = z.object({ deliveryId: z.string().min(1) });

export interface WebhookJobDeps {
  service: Pick<DeliveryService, 'deliver'>;
  repo: Pick<WebhooksRepository, 'recoverStuck' | 'applyRetention' | 'listDue'>;
  queue: WebhookEnqueuer;
  now?: () => Date;
}

/** Runs one job of the `webhook` queue: a delivery to send, or a sweep. */
export async function processWebhookJob(
  job: { name: string; data: unknown },
  deps: WebhookJobDeps,
): Promise<unknown> {
  if (job.name === WEBHOOK_SEND_JOB) {
    const payload = sendPayload.safeParse(job.data);
    if (!payload.success)
      throw new UnrecoverableError('Invalid webhook send payload');
    const { deliveryId } = payload.data;
    return { deliveryId, result: await deps.service.deliver(deliveryId) };
  }
  if (job.name === WEBHOOK_SWEEP_JOB) {
    const now = deps.now?.() ?? new Date();
    const recovered = await deps.repo.recoverStuck(now);
    const retention = await deps.repo.applyRetention(now);
    const due = await deps.repo.listDue(now, WEBHOOK_CONFIG.sweep.limit);
    for (const id of due) await deps.queue.enqueue(id);
    return { recovered, ...retention, enqueued: due.length };
  }
  throw new UnrecoverableError(`Unsupported job: ${job.name}`);
}
