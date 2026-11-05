import { ApiProperty } from '@nestjs/swagger';
import {
  Arrangement,
  Channel,
  Seniority,
  SkillDomain,
  Technology,
} from 'src/common/enums';
import type { QuerySearchBuilderRow } from 'src/database';

/** Collection claim columns: engine-internal, never returned by the API. */
export const CLAIM_COLUMNS = [
  'claimRunId',
  'claimWindowStart',
  'claimWindowEnd',
  'claimExpiresAt',
] as const;

/** A query search builder as the API returns it. */
export type QueryBuilderView = Omit<
  QuerySearchBuilderRow,
  (typeof CLAIM_COLUMNS)[number]
>;

export function withoutClaim(row: QuerySearchBuilderRow): QueryBuilderView {
  const {
    claimRunId: _runId,
    claimWindowStart: _start,
    claimWindowEnd: _end,
    claimExpiresAt: _expires,
    ...view
  } = row;
  return view;
}

export class QuerySearchBuilderResponseDto implements QueryBuilderView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: Channel, enumName: 'Channel' })
  channel!: Channel;

  @ApiProperty({
    example: 'paris, france',
    description: 'Canonical (lowercased) location text the channels search',
  })
  location!: string;

  @ApiProperty({ enum: Seniority, enumName: 'Seniority' })
  experience!: Seniority;

  @ApiProperty({
    enum: SkillDomain,
    enumName: 'SkillDomain',
    description: 'The skill domain the technologies came from',
  })
  domain!: SkillDomain;

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

  @ApiProperty({
    format: 'date-time',
    nullable: true,
    type: String,
    description:
      'Collection cursor: postings before this were searched; null until first collected',
  })
  coveredUntil!: Date | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}
