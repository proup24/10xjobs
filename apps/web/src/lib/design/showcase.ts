/** The design showcase is visible everywhere except Vercel production. */
export function isShowcaseEnabled(env: { VERCEL_ENV?: string }): boolean {
  return env.VERCEL_ENV !== 'production';
}
