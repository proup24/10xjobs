import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { IsOptionalNonNullable } from 'src/common/decorators';

export class UpdateWorkspaceDto {
  @ApiPropertyOptional({ example: 'Default' })
  @IsOptionalNonNullable()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ example: 'default', pattern: '^[a-z0-9-]{2,64}$' })
  @IsOptionalNonNullable()
  @Matches(/^[a-z0-9-]{2,64}$/, {
    message: 'slug must be 2-64 lowercase letters, digits or dashes',
  })
  slug?: string;
}
