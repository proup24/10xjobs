import { Module } from '@nestjs/common';
import { DatabaseModule } from 'src/database';
import { ActivityModule } from 'src/modules/activity';
import { IngestModule } from 'src/modules/ingest';
import {
  AutoSilenceRepository,
  PrismaAutoSilenceRepository,
} from 'src/modules/processor/repositories/auto-silence.repository';
import { QuerySearchModule } from 'src/modules/queries';
import { SearchSegmentsModule } from 'src/modules/segments';
import { AdminAccess } from './admin-access';
import { AdminGuard } from './admin.guard';
import { PrepareReviewController } from './prepare-review.controller';
import {
  PrepareReviewRepository,
  PrismaPrepareReviewRepository,
} from './prepare-review.repository';
import { PrepareReviewService } from './prepare-review.service';
import { PostsBudgetController } from './posts-budget.controller';
import {
  PostsBudgetRepository,
  PrismaPostsBudgetRepository,
} from './posts-budget.repository';
import { PostsBudgetReportService } from './posts-budget.service';
import { RescuesController } from './rescues.controller';
import {
  PrismaRescuesRepository,
  RescuesRepository,
} from './rescues.repository';

/** Admin-only routes. Only the API app imports it; the worker never does. */
@Module({
  imports: [
    DatabaseModule,
    IngestModule,
    SearchSegmentsModule,
    QuerySearchModule,
    ActivityModule,
  ],
  controllers: [
    PrepareReviewController,
    RescuesController,
    PostsBudgetController,
  ],
  providers: [
    AdminAccess,
    AdminGuard,
    PrepareReviewService,
    {
      provide: PrepareReviewRepository,
      useClass: PrismaPrepareReviewRepository,
    },
    { provide: RescuesRepository, useClass: PrismaRescuesRepository },
    PostsBudgetReportService,
    { provide: PostsBudgetRepository, useClass: PrismaPostsBudgetRepository },
    // The processor's read of the rule; the API never runs the silencing itself.
    { provide: AutoSilenceRepository, useClass: PrismaAutoSilenceRepository },
  ],
  exports: [AdminAccess, AdminGuard],
})
export class AdminModule {}
