/** In-memory segments repository for unit tests; not part of the application build. */
import {
  type NewCollectionBatch,
  type NewSegmentRun,
  SearchSegmentsRepository,
} from '../segments.repository';

export class FakeSearchSegmentsRepository extends SearchSegmentsRepository {
  runs: NewSegmentRun[] = [];
  cursors = new Map<string, Date>();

  collected: {
    run: NewSegmentRun & { id: string };
    batch: NewCollectionBatch;
    advance: string[];
  }[] = [];

  async recordRun(run: NewSegmentRun): Promise<void> {
    this.runs.push(run);
  }

  async recordCollectedRun(
    run: NewSegmentRun & { id: string },
    batch: NewCollectionBatch,
    advance: string[],
  ): Promise<void> {
    this.collected.push({ run, batch, advance });
    await this.advanceCursors(advance, run.windowEnd);
  }

  async advanceCursors(queryIds: string[], until: Date): Promise<void> {
    for (const id of queryIds) {
      const current = this.cursors.get(id);
      if (!current || current < until) this.cursors.set(id, until);
    }
  }
}
