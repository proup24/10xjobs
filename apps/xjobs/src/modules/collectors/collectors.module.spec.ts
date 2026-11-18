import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Channel, isTrialChannel } from 'src/common/enums';
import { CollectorsModule } from './collectors.module';
import { GoogleJobsSearchProvider } from './providers/apify/google-search.provider';
import { AshbyCollector } from './providers/ashby.collector';
import { GreenhouseCollector } from './providers/greenhouse.collector';
import { LinkedinJobBoardCollector } from './providers/linkedin-job-board.collector';
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
        LinkedinPostsCollector,
      ]
        .map((collector) => module.get(collector).channel)
        .sort(),
    ).toEqual(
      // The trial channel's collector arrives with its own task.
      Object.values(Channel)
        .filter((channel) => !isTrialChannel(channel))
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
      LinkedinPostsCollector,
    ].map(
      (trigger) => (module.get(trigger) as unknown as { actor: object }).actor,
    );
    expect(actors.every(Boolean)).toBe(true);
    expect(new Set(actors).size).toBe(3);
  } finally {
    await module.close();
  }
});
