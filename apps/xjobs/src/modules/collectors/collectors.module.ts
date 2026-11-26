import { Module } from '@nestjs/common';
import { AshbyCollector } from './providers/ashby.collector';
import { GreenhouseCollector } from './providers/greenhouse.collector';
import { IndeedCollector } from './providers/indeed.collector';
import { LinkedinJobBoardCollector } from './providers/linkedin-job-board.collector';
import { LinkedinJobBoardCheapCollector } from './providers/linkedin-job-board-cheap.collector';
import { LinkedinJobBoardBebityCollector } from './providers/linkedin-job-board-bebity.collector';
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
    LinkedinJobBoardCheapCollector,
    LinkedinJobBoardBebityCollector,
    LinkedinPostsCollector,
    IndeedCollector,
  ],
  exports: [
    ApifyActorProvider,
    AshbyCollector,
    GreenhouseCollector,
    LinkedinJobBoardCollector,
    LinkedinJobBoardCheapCollector,
    LinkedinJobBoardBebityCollector,
    LinkedinPostsCollector,
    IndeedCollector,
  ],
})
export class CollectorsModule {}
