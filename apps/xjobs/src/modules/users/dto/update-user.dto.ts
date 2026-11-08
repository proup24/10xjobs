import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { IsOptionalNonNullable } from 'src/common/decorators';
import { AddressDto } from './address.dto';

export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptionalNonNullable()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({
    example: 'MA',
    description:
      'ISO 3166-1 alpha-2 country of residence; publishing needs it. Must be an approved country.',
  })
  @IsOptionalNonNullable()
  @IsString()
  @Matches(/^[A-Z]{2}$/, {
    message: 'residenceCountry must be an ISO alpha-2 code such as MA',
  })
  residenceCountry?: string;

  @ApiPropertyOptional({
    description:
      'Whether you need no visa sponsorship (false) or accept an employer sponsoring one (true); publishing needs an answer.',
  })
  @IsOptionalNonNullable()
  @IsBoolean()
  acceptsSponsorship?: boolean;

  @ApiPropertyOptional({
    type: AddressDto,
    nullable: true,
    description: 'null clears the address',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => AddressDto)
  address?: AddressDto | null;
}
