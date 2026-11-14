import { Module } from '@nestjs/common';
import { DatabaseModule } from 'src/database';
import {
  PrismaSearchSegmentsRepository,
  SearchSegmentsRepository,
} from './repositories/segments.repository';
import {
  LinkedinSearchSplitsRepository,
  PrismaLinkedinSearchSplitsRepository,
} from './repositories/splits.repository';

/** Search segments: run records, builder collection cursors and claims. */
@Module({
  imports: [DatabaseModule],
  providers: [
    {
      provide: SearchSegmentsRepository,
      useClass: PrismaSearchSegmentsRepository,
    },
    {
      provide: LinkedinSearchSplitsRepository,
      useClass: PrismaLinkedinSearchSplitsRepository,
    },
  ],
  exports: [SearchSegmentsRepository, LinkedinSearchSplitsRepository],
})
export class SearchSegmentsModule {}
