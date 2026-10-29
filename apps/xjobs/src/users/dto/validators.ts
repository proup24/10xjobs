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
