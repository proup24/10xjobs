import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import type { LocationsByArrangement } from 'src/modules/queries';

/** Most locations one arrangement may list: each one multiplies the searches. */
export const MAX_LOCATIONS = 20;
/** Longest location text accepted. */
export const MAX_LOCATION_LENGTH = 100;

/** Decorators shared by every arrangement's list of location texts. */
function LocationList(example: string[]) {
  const decorators = [
    ApiProperty({
      type: [String],
      example,
      maxItems: MAX_LOCATIONS,
      description:
        'Location texts searched as given ("Europe", "Morocco", "Paris, France"); empty when the arrangement is not wanted',
    }),
    IsArray(),
    ArrayMaxSize(MAX_LOCATIONS),
    IsString({ each: true }),
    MaxLength(MAX_LOCATION_LENGTH, { each: true }),
    Matches(/\S/, { each: true, message: '$property entries must not be blank' }),
  ];
  return (target: object, propertyName: string) => {
    for (const decorate of decorators) decorate(target, propertyName);
  };
}

/** Where to search, per arrangement. The web app only lets users pick valid locations. */
export class LocationsDto implements LocationsByArrangement {
  @LocationList(['Europe', 'Morocco'])
  remote!: string[];

  @LocationList(['France'])
  hybrid!: string[];

  @LocationList(['Paris, France'])
  onsite!: string[];
}
