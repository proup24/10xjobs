import { Logger } from '@nestjs/common';
import type { SilencedAuthorsRepository } from 'src/modules/ingest/repositories/silenced-authors.repository';
import type {
  AutoSilenceCandidate,
  AutoSilenceRepository,
} from '../repositories/auto-silence.repository';
import { AutoSilenceService } from './auto-silence.service';

const candidate = (authorKey: string): AutoSilenceCandidate => ({
  authorKey,
  name: 'Agg Jobs',
  counted: 12,
  firstSeenAt: new Date('2026-11-01T08:00:00.000Z'),
  lastSeenAt: new Date('2026-11-09T08:00:00.000Z'),
  verdicts: { junk: 10, not_hiring: 2 },
});

function make(enabled: boolean, candidates: AutoSilenceCandidate[]) {
  const repo = { candidates: vi.fn(async () => candidates) };
  const silenced = {
    silence: vi.fn(async (input: { authorKey: string }) => {
      if (input.authorKey === 'company:broken') throw new Error('db down');
      return input.authorKey === 'company:raced' ? 'already' : 'silenced';
    }),
  };
  const service = new AutoSilenceService(
    repo as unknown as AutoSilenceRepository,
    silenced as unknown as SilencedAuthorsRepository,
    enabled,
  );
  return { service, repo, silenced };
}

afterEach(() => vi.restoreAllMocks());

describe('AutoSilenceService', () => {
  it('with the setting off, silences nobody and logs who it would silence', async () => {
    const log = vi
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    const { service, silenced } = make(false, [
      candidate('company:agg'),
      candidate('profile:spam'),
    ]);
    expect(await service.run()).toEqual({ silenced: 0, candidates: 2 });
    expect(silenced.silence).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      'would silence company:agg (12 posts, 2026-11-01..2026-11-09)',
    );
    expect(log).toHaveBeenCalledWith(
      'would silence profile:spam (12 posts, 2026-11-01..2026-11-09)',
    );
  });

  it('with the setting on, silences each candidate automatically with its evidence', async () => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const c = candidate('company:agg');
    const { service, silenced } = make(true, [c, candidate('company:raced')]);
    // One was silenced between the query and the write: not counted twice.
    expect(await service.run()).toEqual({ silenced: 1, candidates: 2 });
    expect(silenced.silence).toHaveBeenCalledWith({
      authorKey: 'company:agg',
      name: 'Agg Jobs',
      origin: 'automatic',
      reason: 'automatic: not hiring or junk',
      evidence: {
        authorKey: 'company:agg',
        name: 'Agg Jobs',
        counted: 12,
        firstSeenAt: '2026-11-01T08:00:00.000Z',
        lastSeenAt: '2026-11-09T08:00:00.000Z',
        verdicts: { junk: 10, not_hiring: 2 },
      },
      createdBy: null,
    });
  });

  it('logs a failed silence and goes on with the next candidate', async () => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const error = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const { service, silenced } = make(true, [
      candidate('company:broken'),
      candidate('company:agg'),
    ]);
    expect(await service.run()).toEqual({ silenced: 1, candidates: 2 });
    expect(silenced.silence).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('could not silence company:broken: db down'),
    );
  });

  it('with no candidates, does nothing', async () => {
    const { service, silenced } = make(true, []);
    expect(await service.run()).toEqual({ silenced: 0, candidates: 0 });
    expect(silenced.silence).not.toHaveBeenCalled();
  });
});
