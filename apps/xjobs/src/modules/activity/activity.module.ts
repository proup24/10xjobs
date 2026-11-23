import { Module } from '@nestjs/common';
import { DatabaseModule } from 'src/database';
import {
  ActivityRepository,
  PrismaActivityRepository,
} from './activity.repository';

/**
 * User activity: who is paused, and which search builders only they need.
 * No routes, so the workers can import it; the API adds `SearchesModule`.
 */
@Module({
  imports: [DatabaseModule],
  providers: [
    { provide: ActivityRepository, useClass: PrismaActivityRepository },
  ],
  exports: [ActivityRepository],
})
export class ActivityModule {}
