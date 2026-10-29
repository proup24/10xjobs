import {
  isEmail,
  isURL,
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';
import type { ContactKind } from 'src/common/enums';

const E164 = /^\+[1-9]\d{6,14}$/;
const URL_KINDS: ContactKind[] = [
  'linkedin',
  'github',
  'gitlab',
  'portfolio',
  'website',
];

function isContactValue(kind: unknown, value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0 || value.length > 500) {
    return false;
  }
  if (kind === 'phone') return E164.test(value);
  if (kind === 'email') return isEmail(value);
  if (URL_KINDS.includes(kind as ContactKind)) {
    return isURL(value, { protocols: ['http', 'https'], require_protocol: true });
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
export function IsGreaterOrEqual(property: string, options?: ValidationOptions) {
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
