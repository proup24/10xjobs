import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
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

  @ApiPropertyOptional({ description: 'Trimmed and lowercased before storage' })
  @IsOptionalNonNullable()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(320)
  email?: string;

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
