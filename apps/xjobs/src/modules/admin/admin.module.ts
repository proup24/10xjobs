import { Module } from '@nestjs/common';
import { DatabaseModule } from 'src/database';
import { IngestModule } from 'src/modules/ingest';
import {
  AutoSilenceRepository,
  PrismaAutoSilenceRepository,
} from 'src/modules/processor/repositories/auto-silence.repository';
import { AdminAccess } from './admin-access';
import { AdminGuard } from './admin.guard';
import { PrepareReviewController } from './prepare-review.controller';
import {
  PrepareReviewRepository,
  PrismaPrepareReviewRepository,
} from './prepare-review.repository';
import { PrepareReviewService } from './prepare-review.service';

/** Admin-only routes. Only the API app imports it; the worker never does. */
@Module({
  imports: [DatabaseModule, IngestModule],
  controllers: [PrepareReviewController],
  providers: [
    AdminAccess,
    AdminGuard,
    PrepareReviewService,
    {
      provide: PrepareReviewRepository,
      useClass: PrismaPrepareReviewRepository,
    },
    // The processor's read of the rule; the API never runs the silencing itself.
    { provide: AutoSilenceRepository, useClass: PrismaAutoSilenceRepository },
  ],
  exports: [AdminAccess, AdminGuard],
})
export class AdminModule {}
