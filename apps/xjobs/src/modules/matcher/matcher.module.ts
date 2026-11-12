import { Module } from '@nestjs/common';
import { DatabaseModule } from 'src/database';
import { FactsModule } from 'src/modules/facts';
import { RatesModule } from 'src/modules/rates';
import {
  MatcherRepository,
  PrismaMatcherRepository,
} from './repositories/matcher.repository';
import { MatcherService } from './services/matcher.service';

/** Decides processed jobs, from their combined facts, against published profiles and stores the results. */
@Module({
  imports: [DatabaseModule, FactsModule, RatesModule],
  providers: [
    MatcherService,
    { provide: MatcherRepository, useClass: PrismaMatcherRepository },
  ],
  exports: [MatcherService, MatcherRepository],
})
export class MatcherModule {}
