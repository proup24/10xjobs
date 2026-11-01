import { UnrecoverableError } from 'bullmq';
import { z } from 'zod';

const pingPayload = z.object({ token: z.string().min(1).max(200) }).strict();

export async function processInfrastructureJob(job: { name: string; data: unknown }) {
  if (job.name !== 'ping')
    throw new UnrecoverableError(`Unsupported job: ${job.name}`);
  const payload = pingPayload.safeParse(job.data);
  if (!payload.success) throw new UnrecoverableError('Invalid ping payload');
  return { token: payload.data.token, status: 'ok' as const };
}
