import { Module } from '@nestjs/common';
import { DatabaseModule } from 'src/database';
import { SearchesController } from './searches.controller';
import {
  ActivityRepository,
  PrismaActivityRepository,
} from './activity.repository';

/** User activity: who is paused, and which search builders only they need. */
@Module({
  imports: [DatabaseModule],
  controllers: [SearchesController],
  providers: [
    { provide: ActivityRepository, useClass: PrismaActivityRepository },
  ],
  exports: [ActivityRepository],
})
export class ActivityModule {}
