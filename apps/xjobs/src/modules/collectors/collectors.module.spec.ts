import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Channel } from 'src/common/enums';
import { COLLECTOR_PROVIDERS, CollectorsModule } from './collectors.module';
import { ApifyActorProvider } from './providers/apify/apify.provider';
import type { Collector } from './types/collector';

it('wires one collector per channel and the Apify provider without a token', async () => {
  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
      CollectorsModule,
    ],
  }).compile();
  try {
    const collectors = module.get<Collector[]>(COLLECTOR_PROVIDERS);
    expect(collectors.map((c) => c.channel).sort()).toEqual(
      Object.values(Channel).sort(),
    );
    expect(module.get(ApifyActorProvider)).toBeInstanceOf(ApifyActorProvider);
  } finally {
    await module.close();
  }
});
