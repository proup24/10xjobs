import { Module } from '@nestjs/common';
import { WorkspacesModule } from 'src/modules/workspaces';
import { QuerySearchController } from './controllers/query-search.controller';
import {
  PrismaQuerySearchRepository,
  QuerySearchRepository,
} from './repositories/queries.repository';
import { QuerySearchService } from './services/queries.service';

@Module({
  imports: [WorkspacesModule],
  controllers: [QuerySearchController],
  providers: [
    QuerySearchService,
    {
      provide: QuerySearchRepository,
      useClass: PrismaQuerySearchRepository,
    },
  ],
  exports: [QuerySearchService],
})
export class QuerySearchModule {}
