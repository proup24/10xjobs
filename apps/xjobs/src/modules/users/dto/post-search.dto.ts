import { ApiProperty } from '@nestjs/swagger';

/** The old `/post-search` routes' answer; slice 04b deletes them. */
export class PostSearchResponseDto {
  @ApiProperty()
  enabled!: boolean;

  @ApiProperty({ description: 'Whether post search is available to turn on' })
  allowed!: boolean;

  @ApiProperty({ description: 'Post searches the profile would get' })
  searches!: number;
}
