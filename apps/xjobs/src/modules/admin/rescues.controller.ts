import { Controller, Get, HttpStatus, Query, UseGuards } from '@nestjs/common';
import {
  ApiProperty,
  ApiPropertyOptional,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiErrorResponses, ApiSuccessResponse } from 'src/common/decorators';
import { UserGuard } from 'src/common/guards';
import { ENGINE_KEY_AND_BEARER } from 'src/swagger/security';
import { AdminGuard } from './admin.guard';
import { RescuesRepository } from './rescues.repository';

const DEFAULT_LIMIT = 100;

export class RescuesQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: DEFAULT_LIMIT })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class RescueJobViewDto {
  @ApiProperty() id!: string;
  @ApiProperty() kind!: string;
  @ApiProperty({ nullable: true, type: String }) title!: string | null;
  @ApiProperty() postingUrl!: string;
}

export class RescueUserViewDto {
  @ApiProperty() id!: string;
}

export class RescueViewDto {
  @ApiProperty() id!: string;
  @ApiProperty() createdAt!: string;
  @ApiProperty({ nullable: true, type: String }) undoneAt!: string | null;
  @ApiProperty({ enum: ['junk', 'disqualified'] }) origin!: string;
  @ApiProperty({ nullable: true, type: String }) note!: string | null;
  @ApiProperty({
    description: 'What the system said when the user rescued the post',
    type: 'object',
    additionalProperties: true,
  })
  snapshot!: unknown;
  @ApiProperty({ type: RescueJobViewDto }) job!: RescueJobViewDto;
  @ApiProperty({ type: RescueUserViewDto }) user!: RescueUserViewDto;
}

export class RescuesResponseDto {
  @ApiProperty({ type: [RescueViewDto] }) items!: RescueViewDto[];
}

@ApiTags('admin')
@ApiSecurity(ENGINE_KEY_AND_BEARER)
@ApiErrorResponses(HttpStatus.UNAUTHORIZED, HttpStatus.INTERNAL_SERVER_ERROR)
@Controller('admin')
@UseGuards(UserGuard)
export class RescuesController {
  constructor(private readonly rescues: RescuesRepository) {}

  @ApiSuccessResponse(RescuesResponseDto, {
    description:
      "Every user's post rescues, undone ones included, newest first",
  })
  @ApiErrorResponses(HttpStatus.BAD_REQUEST, HttpStatus.FORBIDDEN)
  @UseGuards(AdminGuard)
  @Get('rescues')
  async list(@Query() query: RescuesQueryDto): Promise<RescuesResponseDto> {
    const rows = await this.rescues.list(query.limit ?? DEFAULT_LIMIT);
    return {
      items: rows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
        undoneAt: row.undoneAt?.toISOString() ?? null,
      })),
    };
  }
}
