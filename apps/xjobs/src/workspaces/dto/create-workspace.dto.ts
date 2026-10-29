import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

export class CreateWorkspaceDto {
  @ApiProperty({ example: 'Default' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiProperty({ example: 'default', pattern: '^[a-z0-9-]{2,64}$' })
  @Matches(/^[a-z0-9-]{2,64}$/, {
    message: 'slug must be 2-64 lowercase letters, digits or dashes',
  })
  slug!: string;
}
