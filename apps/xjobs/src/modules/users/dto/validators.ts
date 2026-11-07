import {
  isEmail,
  isURL,
  isUUID,
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';
import { ContactKind } from 'src/common/enums';
import { LOCATION_ARRANGEMENTS, LOCATIONS_REQUIRED } from 'src/modules/queries';
import type { PlacesByArrangement } from '../types';

/** A value-list code: lowercase letters, digits and underscores (`backend_engineer`, `per_task`). */
export const CODE = /^[a-z0-9_]+$/;
/** A regions code (`EMEA`, `NORTH_AFRICA`). */
export const REGION_CODE = /^[A-Z][A-Z0-9_]*$/;
/** An ISO 3166-1 alpha-2 country code. */
export const COUNTRY_CODE = /^[A-Z]{2}$/;
/** An ISO 639-1 language code. */
export const LANGUAGE_CODE = /^[a-z]{2}$/;
/** An ISO 4217 currency code. */
export const CURRENCY_CODE = /^[A-Z]{3}$/;

/** True when `value` has exactly the keys `keys`. */
function hasExactKeys(value: object, keys: string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => own.includes(key));
}

/**
 * True when `value` is a place in shape: `{ kind: 'worldwide' }`, a region or
 * country by code, or a city by uuid. Whether the code is approved is the
 * database's call.
 */
export function isPlace(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false;
  const place = value as Record<string, unknown>;
  switch (place.kind) {
    case 'worldwide':
      return hasExactKeys(place, ['kind']);
    case 'region':
      return (
        hasExactKeys(place, ['kind', 'code']) &&
        typeof place.code === 'string' &&
        place.code.length <= 64 &&
        REGION_CODE.test(place.code)
      );
    case 'country':
      return (
        hasExactKeys(place, ['kind', 'code']) &&
        typeof place.code === 'string' &&
        COUNTRY_CODE.test(place.code)
      );
    case 'city':
      return (
        hasExactKeys(place, ['kind', 'id']) &&
        typeof place.id === 'string' &&
        isUUID(place.id)
      );
    default:
      return false;
  }
}

/** Validates each entry with {@link isPlace}. */
export function IsPlace(options?: ValidationOptions) {
  return (target: object, propertyName: string) =>
    registerDecorator({
      name: 'isPlace',
      target: target.constructor,
      propertyName,
      options: {
        message: `${propertyName} entries must be { kind: 'worldwide' }, { kind: 'region' | 'country', code } or { kind: 'city', id }`,
        ...options,
      },
      validator: { validate: (value: unknown) => isPlace(value) },
    });
}

const E164 = /^\+[1-9]\d{6,14}$/;
const URL_KINDS: ContactKind[] = [
  ContactKind.linkedin,
  ContactKind.github,
  ContactKind.gitlab,
  ContactKind.portfolio,
  ContactKind.website,
];

/** True when `value` is a valid contact of `kind`; see {@link IsContactValue}. */
export function isContactValue(kind: unknown, value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0 || value.length > 500) {
    return false;
  }
  if (kind === ContactKind.phone) return E164.test(value);
  if (kind === ContactKind.email) return isEmail(value);
  if (URL_KINDS.includes(kind as ContactKind)) {
    return isURL(value, {
      protocols: ['http', 'https'],
      require_protocol: true,
    });
  }
  return true;
}

/**
 * @description Validates a contact's `value` against the `kind` on the same
 * object: E.164 for phones, an email for emails, an http(s) URL for profile
 * links, any 1–500 character string otherwise.
 */
export function IsContactValue(options?: ValidationOptions) {
  return (target: object, propertyName: string) =>
    registerDecorator({
      name: 'isContactValue',
      target: target.constructor,
      propertyName,
      options: {
        message: (args: ValidationArguments) =>
          `value is not a valid ${String((args.object as { kind?: unknown }).kind)} contact`,
        ...options,
      },
      validator: {
        validate: (value: unknown, args: ValidationArguments) =>
          isContactValue((args.object as { kind?: unknown }).kind, value),
      },
    });
}

/**
 * @description Requires the value to be a number no smaller than the number
 * in `property` on the same object. Skips the check when that one is missing,
 * leaving it to that property's own validators.
 */
export function IsGreaterOrEqual(
  property: string,
  options?: ValidationOptions,
) {
  return (target: object, propertyName: string) =>
    registerDecorator({
      name: 'isGreaterOrEqual',
      target: target.constructor,
      propertyName,
      constraints: [property],
      options: {
        message: `${propertyName} must be greater than or equal to ${property}`,
        ...options,
      },
      validator: {
        validate: (value: unknown, args: ValidationArguments) => {
          const other = (args.object as Record<string, unknown>)[property];
          if (typeof other !== 'number') return true;
          return typeof value === 'number' && value >= other;
        },
      },
    });
}

/** Requires no two items of an array to share the values of `keys`. */
export function UniqueBy(keys: string[], options?: ValidationOptions) {
  return (target: object, propertyName: string) =>
    registerDecorator({
      name: 'uniqueBy',
      target: target.constructor,
      propertyName,
      constraints: keys,
      options: {
        message: `${propertyName} must not repeat the same ${keys.join(' and ')}`,
        ...options,
      },
      validator: {
        validate: (value: unknown) => {
          if (!Array.isArray(value)) return true;
          const seen = new Set(
            value.map((item: Record<string, unknown>) =>
              JSON.stringify(keys.map((key) => item?.[key])),
            ),
          );
          return seen.size === value.length;
        },
      },
    });
}

/**
 * @description Requires at least one location across every arrangement.
 * Skips the check when the value is not an object, leaving it to the nested
 * validators.
 */
export function HasLocation(options?: ValidationOptions) {
  return (target: object, propertyName: string) =>
    registerDecorator({
      name: 'hasLocation',
      target: target.constructor,
      propertyName,
      options: { message: LOCATIONS_REQUIRED, ...options },
      validator: {
        validate: (value: unknown) => {
          if (typeof value !== 'object' || value === null) return true;
          const lists = value as Partial<PlacesByArrangement>;
          if (![lists.remote, lists.hybrid, lists.onsite].every(Array.isArray))
            return true;
          return LOCATION_ARRANGEMENTS.some(
            (arrangement) => (lists[arrangement]?.length ?? 0) > 0,
          );
        },
      },
    });
}
