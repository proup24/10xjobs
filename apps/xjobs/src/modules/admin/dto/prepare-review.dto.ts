import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  LISTED_VERDICTS,
  POST_VERDICT_REASONS,
  type ListedVerdict,
} from '@xjobs/database/enums';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class DropsQueryDto {
  @ApiPropertyOptional({
    description:
      'Only drops of this rule (the name after "prepare: "; "no-text" is one)',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  rule?: string;

  @ApiPropertyOptional({ description: 'The `next` of the previous page' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  before?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class VerdictsQueryDto {
  @ApiPropertyOptional({ enum: [...LISTED_VERDICTS] })
  @IsOptional()
  @IsIn([...LISTED_VERDICTS])
  verdict?: ListedVerdict;

  @ApiPropertyOptional({ enum: [...POST_VERDICT_REASONS] })
  @IsOptional()
  @IsIn([...POST_VERDICT_REASONS])
  reason?: string;

  @ApiPropertyOptional({ description: 'The `next` of the previous page' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  before?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class SilencedPostsQueryDto {
  @ApiPropertyOptional({ description: 'The `next` of the previous page' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  before?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export const AUTHOR_KEY = /^(profile|company):.+/;

export class SilenceAuthorDto {
  @ApiProperty({ example: 'profile:jane-doe' })
  @IsString()
  @MaxLength(300)
  @Matches(AUTHOR_KEY)
  authorKey!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  name?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}

export class AuthorViewDto {
  @ApiProperty({ nullable: true, type: String }) key!: string | null;
  @ApiProperty({ nullable: true, type: String }) name!: string | null;
  @ApiProperty({ nullable: true, type: String }) headline!: string | null;
  @ApiProperty({ nullable: true, type: String }) profileUrl!: string | null;
}

export class AdminMeResponseDto {
  @ApiProperty() admin!: boolean;
}

export class DropViewDto {
  @ApiProperty() rawItemId!: string;
  @ApiProperty() reason!: string;
  @ApiProperty({ nullable: true, type: String }) rule!: string | null;
  @ApiProperty({ nullable: true, type: String }) match!: string | null;
  @ApiProperty({ nullable: true, type: String }) postedAt!: string | null;
  @ApiProperty({ nullable: true, type: String }) url!: string | null;
  @ApiProperty({ type: AuthorViewDto }) author!: AuthorViewDto;
}

export class DropsPageDto {
  @ApiProperty({ type: [DropViewDto] }) items!: DropViewDto[];
  @ApiProperty({ nullable: true, type: String }) next!: string | null;
}

export class HeldPostViewDto {
  @ApiProperty() jobId!: string;
  @ApiProperty() url!: string;
  @ApiProperty({ type: AuthorViewDto }) author!: AuthorViewDto;
  @ApiProperty({ nullable: true, type: String }) postedAt!: string | null;
}

export class HeldPostsPageDto {
  @ApiProperty({ type: [HeldPostViewDto] }) items!: HeldPostViewDto[];
  @ApiProperty({ nullable: true, type: String }) next!: string | null;
}

export class VerdictViewDto {
  @ApiProperty() jobId!: string;
  @ApiProperty({ enum: [...LISTED_VERDICTS] }) verdict!: ListedVerdict;
  @ApiProperty({ enum: [...POST_VERDICT_REASONS] }) reason!: string;
  @ApiProperty() quote!: string;
  @ApiProperty({ enum: ['sure', 'unsure'] }) confidence!: 'sure' | 'unsure';
  @ApiProperty({ type: AuthorViewDto }) author!: AuthorViewDto;
  @ApiProperty({ nullable: true, type: String }) postedAt!: string | null;
  @ApiProperty() url!: string;
  @ApiProperty() extractedAt!: string;
}

export class VerdictsPageDto {
  @ApiProperty({ type: [VerdictViewDto] }) items!: VerdictViewDto[];
  @ApiProperty({ nullable: true, type: String }) next!: string | null;
}

export class SilencedAuthorViewDto {
  @ApiProperty() id!: string;
  @ApiProperty() authorKey!: string;
  @ApiProperty({ nullable: true, type: String }) name!: string | null;
  @ApiProperty() reason!: string;
  @ApiProperty({ enum: ['manual', 'automatic'] }) origin!:
    | 'manual'
    | 'automatic';
  @ApiProperty({
    nullable: true,
    description: 'Why an automatic entry was added',
  })
  evidence!: unknown;
  @ApiProperty({ nullable: true, type: String }) createdBy!: string | null;
  @ApiProperty() createdAt!: string;
}

export class SilenceAuthorResponseDto {
  @ApiProperty({ enum: ['silenced', 'already'] })
  status!: 'silenced' | 'already';
}
