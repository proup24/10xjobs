import { ValidateIf, type ValidationOptions } from 'class-validator';

/**
 * @description For PATCH bodies: the field may be left out, but when it is
 * sent it must pass the other validators, so `null` is rejected. Unlike
 * `@IsOptional()`, which also skips validation for `null`.
 */
export function IsOptionalNonNullable(options?: ValidationOptions) {
  return ValidateIf((_object, value) => value !== undefined, options);
}
