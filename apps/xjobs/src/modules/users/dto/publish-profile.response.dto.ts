import { ApiProperty } from '@nestjs/swagger';
import type { PublishedProfileView } from '../types';
import { ProfileResponseDto } from './profile.response.dto';

export class QuerySearchCountsResponseDto {
  @ApiProperty({ description: 'Query search builders created by this publish' })
  created!: number;

  @ApiProperty({ description: 'Query search builders that already existed' })
  existing!: number;
}

export class PublishProfileResponseDto
  extends ProfileResponseDto
  implements PublishedProfileView
{
  @ApiProperty({ type: QuerySearchCountsResponseDto })
  querySearches!: QuerySearchCountsResponseDto;
}
