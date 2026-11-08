import { Module } from '@nestjs/common';
import { DatabaseModule } from 'src/database';
import {
  MatcherRepository,
  PrismaMatcherRepository,
} from './repositories/matcher.repository';
import { MatcherService } from './services/matcher.service';

/** Decides processed jobs against published profiles and stores the results. */
@Module({
  imports: [DatabaseModule],
  providers: [
    MatcherService,
    { provide: MatcherRepository, useClass: PrismaMatcherRepository },
  ],
  exports: [MatcherService, MatcherRepository],
})
export class MatcherModule {}
