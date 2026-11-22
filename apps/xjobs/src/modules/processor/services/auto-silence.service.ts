import { Inject, Injectable, Logger } from '@nestjs/common';
import { SilencedAuthorsRepository } from 'src/modules/ingest/repositories/silenced-authors.repository';
import { AutoSilenceRepository } from '../repositories/auto-silence.repository';

/** Nest injection token: `POST_AUTO_SILENCE`, off unless set. */
export const POST_AUTO_SILENCE = Symbol('POST_AUTO_SILENCE');

export const AUTO_SILENCE_REASON = 'automatic: not hiring or junk';

const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The daily automatic silencing run. Off (the default), it only logs who the
 * rule would silence, so the owner can check the threshold first; on, it
 * silences each candidate engine-wide with its evidence. A wrong silence hides
 * an author's real posts from everyone, hence off until the owner agrees.
 */
@Injectable()
export class AutoSilenceService {
  private readonly logger = new Logger(AutoSilenceService.name);

  constructor(
    private readonly repo: AutoSilenceRepository,
    private readonly silenced: SilencedAuthorsRepository,
    @Inject(POST_AUTO_SILENCE) private readonly enabled: boolean,
  ) {}

  async run(): Promise<{ silenced: number; candidates: number }> {
    const candidates = await this.repo.candidates();
    if (!this.enabled) {
      for (const c of candidates)
        this.logger.log(
          `would silence ${c.authorKey} (${c.counted} posts, ${day(c.firstSeenAt)}..${day(c.lastSeenAt)})`,
        );
      this.logger.log(
        `POST_AUTO_SILENCE off: ${candidates.length} author(s) would be silenced`,
      );
      return { silenced: 0, candidates: candidates.length };
    }
    let silenced = 0;
    for (const c of candidates) {
      let status: 'silenced' | 'already';
      try {
        status = await this.silenced.silence({
          authorKey: c.authorKey,
          name: c.name,
          origin: 'automatic',
          reason: AUTO_SILENCE_REASON,
          evidence: {
            ...c,
            firstSeenAt: c.firstSeenAt.toISOString(),
            lastSeenAt: c.lastSeenAt.toISOString(),
          },
          createdBy: null,
        });
      } catch (error) {
        // One failure must not stop the others; tomorrow's run retries it.
        this.logger.error(
          `could not silence ${c.authorKey}: ${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }
      if (status === 'silenced') {
        silenced++;
        this.logger.log(
          `silenced ${c.authorKey} (${c.counted} posts, ${day(c.firstSeenAt)}..${day(c.lastSeenAt)})`,
        );
      }
    }
    return { silenced, candidates: candidates.length };
  }
}
