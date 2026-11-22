import { Channel } from 'src/common/enums';
import { channelJobsConfig } from 'src/infrastructure/jobs/steps/collect';
import { SWEEP_JOB } from 'src/infrastructure/jobs/steps/ingest/queue.service';
import { MATCH_SWEEP_JOB } from 'src/infrastructure/jobs/steps/match';
import { WEBHOOK_SWEEP_JOB } from 'src/infrastructure/jobs/steps/webhook';
import {
  AUTO_SILENCE_JOB,
  PROCESS_SWEEP_JOB,
} from 'src/infrastructure/jobs/steps/process';
import { RATES_REFRESH_JOB } from 'src/infrastructure/jobs/steps/rates';
import {
  syncAutoSilenceScheduler,
  syncCollectionScheduler,
  syncMatchSweepScheduler,
  syncWebhookSweepScheduler,
  syncProcessSweepScheduler,
  syncRatesRefreshScheduler,
  syncSweepScheduler,
} from '../scheduler';

describe('syncCollectionScheduler', () => {
  const queue = () => ({
    upsertJobScheduler: vi.fn(async () => undefined),
    removeJobScheduler: vi.fn(async () => true),
  });

  it("upserts the channel's cron scheduler when enabled", async () => {
    const q = queue();
    expect(
      await syncCollectionScheduler(
        q as never,
        channelJobsConfig[Channel.LINKEDIN_JOB_BOARD],
        true,
      ),
    ).toBe('scheduled');
    expect(q.upsertJobScheduler).toHaveBeenCalledWith(
      'collect',
      { pattern: '0 9-21 * * 1-5', tz: 'Africa/Casablanca' },
      { name: 'collect', opts: { attempts: 1 } },
    );
    expect(q.removeJobScheduler).not.toHaveBeenCalled();
  });

  it('gives LinkedIn jobs a one-hour window and posts their hourly window', () => {
    expect(channelJobsConfig[Channel.LINKEDIN_JOB_BOARD].window).toEqual({
      initialHours: 1,
      overlapMinutes: 0,
      maximumHours: 1,
    });
    expect(channelJobsConfig[Channel.LINKEDIN_POSTS]).toMatchObject({
      schedule: { pattern: '0 * * * *', timezone: 'Africa/Casablanca' },
      window: { overlapMinutes: 5 },
    });
  });

  it('schedules posts every hour of every day, Morocco time', async () => {
    const q = queue();
    expect(
      await syncCollectionScheduler(
        q as never,
        channelJobsConfig[Channel.LINKEDIN_POSTS],
        true,
      ),
    ).toBe('scheduled');
    expect(q.upsertJobScheduler).toHaveBeenCalledWith(
      'collect',
      { pattern: '0 * * * *', tz: 'Africa/Casablanca' },
      { name: 'collect', opts: { attempts: 1 } },
    );
  });

  it('removes the scheduler when the channel is disabled', async () => {
    const q = queue();
    expect(
      await syncCollectionScheduler(
        q as never,
        {
          ...channelJobsConfig[Channel.LINKEDIN_JOB_BOARD],
          enabled: false,
        },
        true,
      ),
    ).toBe('removed');
    expect(q.removeJobScheduler).toHaveBeenCalledWith('collect');
    expect(q.upsertJobScheduler).not.toHaveBeenCalled();
  });

  it('removes the collection scheduler when schedules are off', async () => {
    const q = queue();
    expect(
      await syncCollectionScheduler(
        q as never,
        channelJobsConfig[Channel.LINKEDIN_JOB_BOARD],
        false,
      ),
    ).toBe('removed');
    expect(q.removeJobScheduler).toHaveBeenCalledWith('collect');
    expect(q.upsertJobScheduler).not.toHaveBeenCalled();
  });
});

describe('syncSweepScheduler', () => {
  it('sweeps stale pending batches every five minutes', async () => {
    const q = {
      upsertJobScheduler: vi.fn(async () => undefined),
      removeJobScheduler: vi.fn(async () => true),
    };
    expect(await syncSweepScheduler(q as never, true)).toBe('scheduled');
    expect(q.upsertJobScheduler).toHaveBeenCalledWith(
      'sweep',
      { every: 300_000 },
      { name: 'sweep', opts: { attempts: 1 } },
    );
  });
});

it('removes every scheduler when schedules are off', async () => {
  for (const [sync, id] of [
    [syncSweepScheduler, SWEEP_JOB],
    [syncProcessSweepScheduler, PROCESS_SWEEP_JOB],
    [syncMatchSweepScheduler, MATCH_SWEEP_JOB],
    [syncWebhookSweepScheduler, WEBHOOK_SWEEP_JOB],
    [syncRatesRefreshScheduler, RATES_REFRESH_JOB],
    [syncAutoSilenceScheduler, AUTO_SILENCE_JOB],
  ] as const) {
    const q = {
      upsertJobScheduler: vi.fn(async () => undefined),
      removeJobScheduler: vi.fn(async () => true),
    };
    expect(await sync(q as never, false)).toBe('removed');
    expect(q.removeJobScheduler).toHaveBeenCalledWith(id);
    expect(q.upsertJobScheduler).not.toHaveBeenCalled();
  }
});

describe('syncRatesRefreshScheduler', () => {
  it('schedules the refresh daily at 03:00 UTC', async () => {
    const q = {
      upsertJobScheduler: vi.fn(async () => undefined),
      removeJobScheduler: vi.fn(async () => true),
    };
    expect(await syncRatesRefreshScheduler(q as never, true)).toBe('scheduled');
    expect(q.upsertJobScheduler).toHaveBeenCalledWith(
      'refresh',
      { pattern: '0 3 * * *', tz: 'UTC' },
      { name: 'refresh', opts: { attempts: 1 } },
    );
  });
});

describe('syncAutoSilenceScheduler', () => {
  it('schedules the automatic silencing run daily at 04:00 UTC', async () => {
    const q = {
      upsertJobScheduler: vi.fn(async () => undefined),
      removeJobScheduler: vi.fn(async () => true),
    };
    expect(await syncAutoSilenceScheduler(q as never, true)).toBe('scheduled');
    expect(q.upsertJobScheduler).toHaveBeenCalledWith(
      'auto-silence',
      { pattern: '0 4 * * *', tz: 'UTC' },
      { name: 'auto-silence', opts: { attempts: 1 } },
    );
  });
});
