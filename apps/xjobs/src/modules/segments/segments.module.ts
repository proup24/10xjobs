import { Module } from '@nestjs/common';
import { DatabaseModule } from 'src/database';
import {
  PrismaSearchSegmentsRepository,
  SearchSegmentsRepository,
} from './repositories/segments.repository';

/** Search segments: run records, builder collection cursors and claims. */
@Module({
  imports: [DatabaseModule],
  providers: [
    {
      provide: SearchSegmentsRepository,
      useClass: PrismaSearchSegmentsRepository,
    },
  ],
  exports: [SearchSegmentsRepository],
})
export class SearchSegmentsModule {}
