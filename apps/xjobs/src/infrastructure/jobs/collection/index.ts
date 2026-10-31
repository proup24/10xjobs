import { Channel } from 'src/common/enums';
import { AshbyCollectionJob } from './ashby.job';
import { GreenhouseCollectionJob } from './greenhouse.job';
import { LinkedinJobBoardCollectionJob } from './linkedin-job-board.job';
import { LinkedinPostsCollectionJob } from './linkedin-posts.job';

export { CollectionWorkerModule } from './collection-worker.module';

/** Each channel's own collection job. */
export const COLLECTION_JOBS = {
  [Channel.LINKEDIN_JOB_BOARD]: LinkedinJobBoardCollectionJob,
  [Channel.LINKEDIN_POSTS]: LinkedinPostsCollectionJob,
  [Channel.GREEN_HOUSE]: GreenhouseCollectionJob,
  [Channel.ASHBY]: AshbyCollectionJob,
} as const;
