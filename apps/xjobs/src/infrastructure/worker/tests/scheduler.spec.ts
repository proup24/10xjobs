import { Channel } from 'src/common/enums';
import { channelJobsConfig } from 'src/infrastructure/jobs/steps/collect';
import { syncCollectionScheduler, syncSweepScheduler } from '../scheduler';

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
      ),
    ).toBe('scheduled');
    expect(q.upsertJobScheduler).toHaveBeenCalledWith(
      'collect',
      { pattern: '0 * * * *', tz: 'UTC' },
      { name: 'collect', opts: { attempts: 1 } },
    );
    expect(q.removeJobScheduler).not.toHaveBeenCalled();
  });

  it('removes the scheduler when the channel is disabled', async () => {
    const q = queue();
    expect(
      await syncCollectionScheduler(q as never, {
        ...channelJobsConfig[Channel.LINKEDIN_JOB_BOARD],
        enabled: false,
      }),
    ).toBe('removed');
    expect(q.removeJobScheduler).toHaveBeenCalledWith('collect');
    expect(q.upsertJobScheduler).not.toHaveBeenCalled();
  });
});

describe('syncSweepScheduler', () => {
  it('sweeps stale pending batches every five minutes', async () => {
    const q = { upsertJobScheduler: vi.fn(async () => undefined) };
    await syncSweepScheduler(q as never);
    expect(q.upsertJobScheduler).toHaveBeenCalledWith(
      'sweep',
      { every: 300_000 },
      { name: 'sweep', opts: { attempts: 1 } },
    );
  });
});
