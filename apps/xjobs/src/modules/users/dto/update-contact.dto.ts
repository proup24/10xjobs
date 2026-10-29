import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { IsOptionalNonNullable } from 'src/common/decorators';
import { ContactKind } from 'src/common/enums';
import { IsContactValue } from './validators';

/** The service re-checks `value` against the merged `kind` when only one is sent. */
export class UpdateContactDto {
  @ApiPropertyOptional({ enum: ContactKind, enumName: 'ContactKind' })
  @IsOptionalNonNullable()
  @IsEnum(ContactKind)
  kind?: ContactKind;

  @ApiPropertyOptional()
  @IsOptionalNonNullable()
  @IsContactValue()
  value?: string;

  @ApiPropertyOptional({ nullable: true, description: 'null clears the label' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string | null;

  @ApiPropertyOptional()
  @IsOptionalNonNullable()
  @IsBoolean()
  isPrimary?: boolean;
}
