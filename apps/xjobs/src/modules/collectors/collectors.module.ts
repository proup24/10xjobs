import { Module } from '@nestjs/common';
import { AshbyCollector } from './providers/ashby.collector';
import { GreenhouseCollector } from './providers/greenhouse.collector';
import { LinkedinJobBoardCollector } from './providers/linkedin-job-board.collector';
import { LinkedinJobBoardCheapCollector } from './providers/linkedin-job-board-cheap.collector';
import { LinkedinJobBoardBebityCollector } from './providers/linkedin-job-board-bebity.collector';
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
  ],
  exports: [
    ApifyActorProvider,
    AshbyCollector,
    GreenhouseCollector,
    LinkedinJobBoardCollector,
    LinkedinJobBoardCheapCollector,
    LinkedinJobBoardBebityCollector,
  ],
})
export class CollectorsModule {}
