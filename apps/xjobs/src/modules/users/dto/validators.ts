import {
  isEmail,
  isURL,
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';
import { type Arrangement, ContactKind } from 'src/common/enums';
import { CITY_REQUIRED, isLocatable } from 'src/modules/queries';

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
 * @description Requires a city when `arrangements` on the same object includes
 * onsite or hybrid: those searches are bound to the user's city. Skips the
 * check when `arrangements` is not an array, leaving it to its own validators.
 */
export function IsLocatableCity(options?: ValidationOptions) {
  return (target: object, propertyName: string) =>
    registerDecorator({
      name: 'isLocatableCity',
      target: target.constructor,
      propertyName,
      options: { message: CITY_REQUIRED, ...options },
      validator: {
        validate: (value: unknown, args: ValidationArguments) => {
          const { arrangements } = args.object as { arrangements?: unknown };
          if (!Array.isArray(arrangements)) return true;
          return isLocatable(
            arrangements as Arrangement[],
            typeof value === 'string' ? value : null,
          );
        },
      },
    });
}

/** Runs `city` validators when a city is given, or when onsite/hybrid needs one. */
export function cityNeedsValidation(object: object, value: unknown): boolean {
  if (value !== null && value !== undefined) return true;
  const { arrangements } = object as { arrangements?: unknown };
  return (
    Array.isArray(arrangements) &&
    !isLocatable(arrangements as Arrangement[], null)
  );
}
