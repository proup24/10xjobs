import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class SetPostSearchDto {
  @ApiProperty({ description: 'Whether LinkedIn post search is on' })
  @IsBoolean()
  enabled!: boolean;
}

export class PostSearchResponseDto {
  @ApiProperty()
  enabled!: boolean;

  @ApiProperty({ description: 'Whether the user may turn the switch on' })
  allowed!: boolean;

  @ApiProperty({ description: 'Post searches the profile would get' })
  searches!: number;
}
