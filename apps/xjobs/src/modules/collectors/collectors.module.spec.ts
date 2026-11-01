import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Channel } from 'src/common/enums';
import { CollectorsModule } from './collectors.module';
import { GoogleJobsSearchProvider } from './providers/apify/google_search.collector';
import { LinkedinJobSearchProvider } from './providers/apify/linkedin.job_search.collector';
import { LinkedinPostSearchProvider } from './providers/apify/linkedin.post_search.collector';
import { AshbyCollector } from './providers/ashby.service';
import { GreenhouseCollector } from './providers/greenhouse.service';
import { LinkedinJobBoardCollector } from './providers/linkedin.job_board.service';
import { LinkedinPostsCollector } from './providers/linkedin.posts.service';

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
    ).toEqual(Object.values(Channel).sort());
  } finally {
    await module.close();
  }
});

it('gives every Apify trigger its own Apify client', async () => {
  const module = await compile();
  try {
    const actors = [
      GoogleJobsSearchProvider,
      LinkedinJobSearchProvider,
      LinkedinPostSearchProvider,
    ].map(
      (trigger) => (module.get(trigger) as unknown as { actor: object }).actor,
    );
    expect(actors.every(Boolean)).toBe(true);
    expect(new Set(actors).size).toBe(3);
  } finally {
    await module.close();
  }
});
