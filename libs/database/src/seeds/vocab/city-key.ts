/**
 * @description The key a city is matched on, with the country code: the one
 * definition shared by the engine and the cities seed.
 */
export function cityNameKey(name: string): string {
  return name.toLowerCase();
}
