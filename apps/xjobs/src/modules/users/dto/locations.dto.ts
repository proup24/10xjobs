import { ApiProperty } from '@nestjs/swagger';
import type { Place, PlacesByArrangement } from '../types';

/** Most places one arrangement may list: each one multiplies the searches. */
export const MAX_LOCATIONS = 20;

/** Swagger decorators shared by every arrangement's list of places; response schema only. */
function PlaceList(example: Place[]) {
  const decorators = [
    ApiProperty({
      type: 'array',
      items: {
        oneOf: [
          {
            type: 'object',
            properties: { kind: { type: 'string', enum: ['worldwide'] } },
            required: ['kind'],
          },
          {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: ['region', 'country'] },
              code: { type: 'string' },
            },
            required: ['kind', 'code'],
          },
          {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: ['city'] },
              id: { type: 'string', format: 'uuid' },
            },
            required: ['kind', 'id'],
          },
        ],
      },
      example,
      maxItems: MAX_LOCATIONS,
      description:
        'Places by code: a regions code, an ISO 3166-1 alpha-2 countries code, or a cities id; empty when the arrangement is not wanted',
    }),
  ];
  return (target: object, propertyName: string) => {
    for (const decorate of decorators) decorate(target, propertyName);
  };
}

/** Where to search, per arrangement. The database checks every code is approved. */
export class LocationsDto implements PlacesByArrangement {
  @PlaceList([{ kind: 'region', code: 'EMEA' }, { kind: 'worldwide' }])
  remote!: Place[];

  @PlaceList([{ kind: 'country', code: 'FR' }])
  hybrid!: Place[];

  @PlaceList([{ kind: 'city', id: '0190f3c2-7a1b-7c3d-8e4f-5a6b7c8d9e0f' }])
  onsite!: Place[];
}
