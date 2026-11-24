import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';
import { SEARCH_SWITCHES, type SearchSwitchKey } from 'src/modules/queries';

export class SetSearchSwitchDto {
  @ApiProperty({ description: 'Whether the search switch is on' })
  @IsBoolean()
  enabled!: boolean;
}

export class SearchSwitchResponseDto {
  @ApiProperty({ enum: SEARCH_SWITCHES.map((sw) => sw.key) })
  key!: SearchSwitchKey;

  @ApiProperty()
  enabled!: boolean;

  @ApiProperty({ description: 'Searches the switch would add for the profile' })
  searches!: number;
}
