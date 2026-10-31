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

  @ApiProperty({ enum: Channel, enumName: 'Channel' })
  channel!: Channel;

  @ApiProperty({
    enum: Region,
    enumName: 'Region',
    nullable: true,
    description: 'Null for onsite and hybrid searches, which use the city',
  })
  locationRegion!: Region | null;

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

  @ApiProperty({
    description: 'Profiles currently associated with this shared builder',
  })
  associatedProfiles!: number;

  @ApiProperty({
    description:
      'Collected only while true: at least one published profile uses it',
  })
  isActive!: boolean;

  @ApiProperty({
    description: 'Soft-deleted: retired, never collected or linked again',
  })
  isDeleted!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}
