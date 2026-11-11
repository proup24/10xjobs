import { Module } from '@nestjs/common';
import {
  PrismaQuerySearchRepository,
  QuerySearchRepository,
} from './repositories/queries.repository';
import { QuerySearchService } from './services/queries.service';

@Module({
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
