import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Channel } from 'src/common/enums';
import { CollectorsModule } from './collectors.module';
import { GoogleJobsSearchProvider } from './providers/apify/google-search.provider';
import { AshbyCollector } from './providers/ashby.collector';
import { GreenhouseCollector } from './providers/greenhouse.collector';
import { LinkedinJobBoardCollector } from './providers/linkedin-job-board.collector';
import { LinkedinJobBoardCheapCollector } from './providers/linkedin-job-board-cheap.collector';
import { LinkedinPostsCollector } from './providers/linkedin-posts.collector';

async function compile() {
  return Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
      CollectorsModule,
    ],
  }).compile();
}

it('provides one collector per channel without an Apify token', async () => {
  const module = await compile();
  try {
    expect(
      [
        AshbyCollector,
        GreenhouseCollector,
        LinkedinJobBoardCollector,
        LinkedinJobBoardCheapCollector,
        LinkedinPostsCollector,
      ]
        .map((collector) => module.get(collector).channel)
        .sort(),
    ).toEqual(
      // bebity has no collector yet (Task 2).
      Object.values(Channel)
        .filter((channel) => channel !== Channel.LINKEDIN_JOB_BOARD_BEBITY)
        .sort(),
    );
  } finally {
    await module.close();
  }
});

it('gives every Apify trigger its own Apify client', async () => {
  const module = await compile();
  try {
    const actors = [
      GoogleJobsSearchProvider,
      LinkedinJobBoardCollector,
      LinkedinJobBoardCheapCollector,
      LinkedinPostsCollector,
    ].map(
      (trigger) => (module.get(trigger) as unknown as { actor: object }).actor,
    );
    expect(actors.every(Boolean)).toBe(true);
    expect(new Set(actors).size).toBe(4);
  } finally {
    await module.close();
  }
});
