import {
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiErrorResponses, ApiSuccessResponse } from 'src/common/decorators';
import type { QuerySearchBuilderRow } from 'src/database';
import { ListQuerySearchQueryDto } from '../dto/list-query-search.query.dto';
import { QuerySearchBuilderResponseDto } from '../dto/query-search-builder.response.dto';
import { QuerySearchService } from '../services/queries.service';

@ApiTags('query-search')
@ApiErrorResponses(HttpStatus.UNAUTHORIZED, HttpStatus.INTERNAL_SERVER_ERROR)
@Controller('workspaces/:workspaceId/query-search')
export class QuerySearchController {
  constructor(private readonly querySearch: QuerySearchService) {}

  @ApiSuccessResponse(QuerySearchBuilderResponseDto, { isArray: true })
  @ApiErrorResponses(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  @Get()
  list(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Query() query: ListQuerySearchQueryDto,
  ): Promise<QuerySearchBuilderRow[]> {
    return this.querySearch.list(workspaceId, query.channel);
  }
}
