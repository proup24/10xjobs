/**
 * Active ISO 4217 currency codes, from the ICU data bundled with Node
 * (`Intl.supportedValuesOf('currency')`, about 160 codes, MAD included).
 */
export const ISO_4217: ReadonlySet<string> = new Set(
  Intl.supportedValuesOf('currency'),
);

/** A currency code trimmed and upper-cased, or null when it is not an active ISO 4217 code. */
export function cleanCurrency(code: string | null): string | null {
  if (code === null) return null;
  const upper = code.trim().toUpperCase();
  return ISO_4217.has(upper) ? upper : null;
}
