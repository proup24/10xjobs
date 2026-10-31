/** In-memory segments repository for unit tests; not part of the application build. */
import {
  type NewSegmentRun,
  SearchSegmentsRepository,
} from '../segments.repository';

export class FakeSearchSegmentsRepository extends SearchSegmentsRepository {
  runs: NewSegmentRun[] = [];
  cursors = new Map<string, Date>();

  async recordRun(run: NewSegmentRun): Promise<void> {
    this.runs.push(run);
  }

  async advanceCursors(queryIds: string[], until: Date): Promise<void> {
    for (const id of queryIds) {
      const current = this.cursors.get(id);
      if (!current || current < until) this.cursors.set(id, until);
    }
  }
}
