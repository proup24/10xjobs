import { ApiProperty } from '@nestjs/swagger';
import type { PublishedProfileView } from '../types';
import { ProfileResponseDto } from './profile.response.dto';

export class QuerySearchCountsResponseDto {
  @ApiProperty({
    description: 'Shared query search builders created by this publish',
  })
  created!: number;

  @ApiProperty({
    description:
      'Recipes that already had a shared builder, reused instead of duplicated',
  })
  existing!: number;
}

export class PublishProfileResponseDto
  extends ProfileResponseDto
  implements PublishedProfileView
{
  @ApiProperty({ type: QuerySearchCountsResponseDto })
  querySearches!: QuerySearchCountsResponseDto;
}
