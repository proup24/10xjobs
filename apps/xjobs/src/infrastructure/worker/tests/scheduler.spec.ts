import { Channel } from 'src/common/enums';
import { channelJobsConfig } from 'src/infrastructure/jobs/steps/collect';
import { SWEEP_JOB } from 'src/infrastructure/jobs/steps/ingest/queue.service';
import { MATCH_SWEEP_JOB } from 'src/infrastructure/jobs/steps/match';
import { PROCESS_SWEEP_JOB } from 'src/infrastructure/jobs/steps/process';
import {
  syncCollectionScheduler,
  syncMatchSweepScheduler,
  syncProcessSweepScheduler,
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
      { pattern: '0 8-22 * * 1-5', tz: 'UTC' },
      { name: 'collect', opts: { attempts: 1 } },
    );
    expect(q.removeJobScheduler).not.toHaveBeenCalled();
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
