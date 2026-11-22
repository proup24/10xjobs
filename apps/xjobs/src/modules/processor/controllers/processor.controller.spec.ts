import { HttpException, HttpStatus } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { ProcessorEnvironmentVariables } from 'src/config';
import {
  ProviderUnavailableError,
  TransientModelError,
} from '../models/errors';
import type { JobState } from '../repositories/processor.repository';
import { ExtractionFailed } from '../services/extraction-pipeline.service';
import {
  ProcessorBlockedError,
  type ProcessorService,
} from '../services/processor.service';
import { ProcessorController } from './processor.controller';

const JOB = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';

function controller(service: Partial<ProcessorService>, key = 'oauth') {
  const config = {
    get: () => key,
  } as unknown as ConfigService<ProcessorEnvironmentVariables, true>;
  return new ProcessorController(service as ProcessorService, config);
}

async function statusOf(promise: Promise<unknown>): Promise<number> {
  const error = await promise.catch((e: unknown) => e);
  if (!(error instanceof HttpException)) throw error;
  return error.getStatus();
}

const body = { description: 'Remote in the EU.' };

describe('ProcessorController', () => {
  it('passes only the title and description to the preview', async () => {
    const preview = vi.fn(async () => ({}) as never);
    await controller({ preview }).preview({
      ...body,
      title: 'Engineer',
    });
    expect(preview).toHaveBeenCalledWith({
      title: 'Engineer',
      description: 'Remote in the EU.',
    });
  });

  it('refuses to call models without a Claude credential, instead of pausing on a 401', async () => {
    const preview = vi.fn();
    expect(await statusOf(controller({ preview }, '').preview(body))).toBe(
      HttpStatus.SERVICE_UNAVAILABLE,
    );
    expect(preview).not.toHaveBeenCalled();
  });

  it.each([
    [new ProcessorBlockedError('over_budget'), HttpStatus.TOO_MANY_REQUESTS],
    [new ProcessorBlockedError('post_cap'), HttpStatus.TOO_MANY_REQUESTS],
    [new ProcessorBlockedError('paused'), HttpStatus.SERVICE_UNAVAILABLE],
    [new ProviderUnavailableError('401'), HttpStatus.SERVICE_UNAVAILABLE],
    [new ExtractionFailed(['x: y']), HttpStatus.UNPROCESSABLE_ENTITY],
    [new TransientModelError('503'), HttpStatus.BAD_GATEWAY],
  ])('maps %s to HTTP %i', async (error, status) => {
    const preview = vi.fn(async () => {
      throw error;
    });
    expect(await statusOf(controller({ preview }).preview(body))).toBe(status);
  });

  it('runs only an existing, in-scope job', async () => {
    const processNow = vi.fn(async () => ({
      outcome: 'processed' as const,
      job: null,
    }));
    const missing = controller({ jobState: async () => null, processNow });
    expect(await statusOf(missing.run(JOB))).toBe(HttpStatus.NOT_FOUND);

    const outOfScope = controller({
      jobState: async () => ({ inScope: false }) as JobState,
      processNow,
    });
    expect(await statusOf(outOfScope.run(JOB))).toBe(
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
    expect(processNow).not.toHaveBeenCalled();

    const ok = controller({
      jobState: async () => ({ inScope: true }) as JobState,
      processNow,
    });
    await expect(ok.run(JOB)).resolves.toEqual({
      outcome: 'processed',
      job: null,
    });
  });

  it('answers 404 for an unknown job', async () => {
    expect(
      await statusOf(controller({ jobState: async () => null }).job(JOB)),
    ).toBe(HttpStatus.NOT_FOUND);
  });
});
