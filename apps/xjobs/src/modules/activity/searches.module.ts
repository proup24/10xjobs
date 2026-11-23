import { Module } from '@nestjs/common';
import { ActivityModule } from './activity.module';
import { SearchesController } from './searches.controller';

/** The API's searches routes (state and resume) over the activity repository. */
@Module({
  imports: [ActivityModule],
  controllers: [SearchesController],
})
export class SearchesModule {}
