import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { SkillDomain, Technology } from 'src/common/enums';

export class SkillDto {
  @ApiProperty({ enum: Technology, enumName: 'Technology' })
  @IsEnum(Technology)
  technology!: Technology;

  @ApiProperty({ enum: SkillDomain, enumName: 'SkillDomain' })
  @IsEnum(SkillDomain)
  domain!: SkillDomain;

  @ApiProperty({ minimum: 0, maximum: 10, description: 'How well you know it' })
  @IsInt()
  @Min(0)
  @Max(10)
  mastery!: number;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: 10,
    default: 5,
    description: 'How much this technology should drive searches; 0 never',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  importance?: number;
}
