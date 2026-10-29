import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { Channel } from 'src/common/enums';

export class ListQuerySearchQueryDto {
  @ApiPropertyOptional({ enum: Channel, enumName: 'Channel' })
  @IsOptional()
  @IsEnum(Channel)
  channel?: Channel;
}
