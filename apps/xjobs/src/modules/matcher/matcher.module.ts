import { Module } from '@nestjs/common';
import { DatabaseModule } from 'src/database';
import { MatcherController } from './controllers/matcher.controller';
import {
  MatcherRepository,
  PrismaMatcherRepository,
} from './repositories/matcher.repository';
import { MatcherService } from './services/matcher.service';

/** Decides processed jobs against published profiles and stores the results. */
@Module({
  imports: [DatabaseModule],
  controllers: [MatcherController],
  providers: [
    MatcherService,
    { provide: MatcherRepository, useClass: PrismaMatcherRepository },
  ],
  exports: [MatcherService, MatcherRepository],
})
export class MatcherModule {}
