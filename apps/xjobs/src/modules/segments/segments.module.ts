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
import { PostsBudgetService } from './services/posts-budget';

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
    PostsBudgetService,
  ],
  exports: [
    SearchSegmentsRepository,
    LinkedinSearchSplitsRepository,
    PostsBudgetService,
  ],
})
export class SearchSegmentsModule {}
