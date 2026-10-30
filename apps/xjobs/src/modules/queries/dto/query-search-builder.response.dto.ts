import { ApiProperty } from '@nestjs/swagger';
import {
  Arrangement,
  Channel,
  Region,
  Seniority,
  Technology,
} from 'src/common/enums';
import type { QuerySearchBuilderRow } from 'src/database';

export class QuerySearchBuilderResponseDto implements QuerySearchBuilderRow {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty({ format: 'uuid' })
  profileId!: string;

  @ApiProperty({ enum: Channel, enumName: 'Channel' })
  channel!: Channel;

  @ApiProperty({ enum: Region, enumName: 'Region' })
  locationRegion!: Region;

  @ApiProperty({ type: String, nullable: true, example: 'MA' })
  country!: string | null;

  @ApiProperty({ type: String, nullable: true })
  city!: string | null;

  @ApiProperty({ enum: Seniority, enumName: 'Seniority' })
  experience!: Seniority;

  @ApiProperty({ enum: Technology, enumName: 'Technology', isArray: true })
  technologies!: Technology[];

  @ApiProperty({ enum: Arrangement, enumName: 'Arrangement' })
  type!: Arrangement;

  @ApiProperty({ type: String })
  keyword!: string;

  @ApiProperty({ type: 'object', additionalProperties: true })
  params!: QuerySearchBuilderRow['params'];

  @ApiProperty({ description: 'Recipe version the hash was computed with' })
  version!: number;

  @ApiProperty({ description: 'SHA-256 of the recipe, hex' })
  hash!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}
