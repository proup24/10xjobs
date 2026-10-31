import { Module } from '@nestjs/common';
import { DatabaseModule } from 'src/database';
import {
  PrismaSearchSegmentsRepository,
  SearchSegmentsRepository,
} from './segments.repository';

/** Search segments: run records and builder collection cursors. */
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
