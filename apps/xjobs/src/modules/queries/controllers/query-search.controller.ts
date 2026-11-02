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
import { ListQuerySearchQueryDto } from '../dto/list-query-search.query.dto';
import {
  type QueryBuilderView,
  QuerySearchBuilderResponseDto,
  withoutClaim,
} from '../dto/query-search-builder.response.dto';
import { QuerySearchService } from '../services/queries.service';

@ApiTags('query-search')
@ApiErrorResponses(HttpStatus.UNAUTHORIZED, HttpStatus.INTERNAL_SERVER_ERROR)
@Controller('users/:userId/profiles/:profileId/query-search')
export class QuerySearchController {
  constructor(private readonly querySearch: QuerySearchService) {}

  @ApiSuccessResponse(QuerySearchBuilderResponseDto, { isArray: true })
  @ApiErrorResponses(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND)
  @Get()
  async list(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @Query() query: ListQuerySearchQueryDto,
  ): Promise<QueryBuilderView[]> {
    const rows = await this.querySearch.list(userId, profileId, query.channel);
    return rows.map(withoutClaim);
  }
}
