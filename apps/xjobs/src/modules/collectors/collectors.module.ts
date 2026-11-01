import { Module } from '@nestjs/common';
import { AshbyCollector } from './providers/ashby.collector';
import { GreenhouseCollector } from './providers/greenhouse.collector';
import { LinkedinJobBoardCollector } from './providers/linkedin-job-board.collector';
import { LinkedinPostsCollector } from './providers/linkedin-posts.collector';
import { ApifyActorProvider } from './providers/apify/apify.provider';
import { GoogleJobsSearchProvider } from './providers/apify/google-search.provider';
import { AshbyPostingProvider } from './providers/extraction/ashby.provider';
import { GreenhousePostingProvider } from './providers/extraction/greenhouse.provider';

@Module({
  providers: [
    ApifyActorProvider,
    GoogleJobsSearchProvider,
    AshbyPostingProvider,
    GreenhousePostingProvider,
    AshbyCollector,
    GreenhouseCollector,
    LinkedinJobBoardCollector,
    LinkedinPostsCollector,
  ],
  exports: [
    AshbyCollector,
    GreenhouseCollector,
    LinkedinJobBoardCollector,
    LinkedinPostsCollector,
  ],
})
export class CollectorsModule {}
