// Pure helpers over the theme variables in global.css. No node:fs here: the
// showcase page imports this on the client.

export type ThemeVars = Record<string, string>;

export function blockVars(css: string, selector: string): ThemeVars {
  const vars: ThemeVars = {};
  const start = new RegExp(`(^|\\n)${selector}\\s*\\{`).exec(css);
  if (!start) return vars;
  const open = start.index + start[0].length;
  const close = css.indexOf('}', open);
  const body = css.slice(open, close === -1 ? undefined : close);
  for (const m of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    vars[m[1]] = m[2].trim();
  }
  return vars;
}

export function parseThemeBlocks(css: string): { light: ThemeVars; dark: ThemeVars } {
  return { light: blockVars(css, ':root'), dark: blockVars(css, '\\.dark') };
}

/** Variables declared in the `@theme inline` block (falls back to `@theme`). */
export function parseThemeInline(css: string): ThemeVars {
  const inline = blockVars(css, '@theme inline');
  return Object.keys(inline).length ? inline : blockVars(css, '@theme');
}

type Rgb = [number, number, number];

function hexToRgba(hex: string): [number, number, number, number] {
  const h = hex.replace('#', '');
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
}

function rgbToHex([r, g, b]: Rgb): string {
  return '#' + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');
}

function lookup(vars: ThemeVars, name: string): string {
  let value = vars[name.replace(/^--/, '')];
  for (let depth = 0; value !== undefined && depth < 16; depth++) {
    const ref = /^var\(--([\w-]+)\)$/.exec(value.trim());
    if (!ref) return value.trim();
    value = vars[ref[1]];
  }
  throw new Error(`Cannot resolve --${name.replace(/^--/, '')} to a color`);
}

export function resolveColor(vars: ThemeVars, name: string): string {
  const value = lookup(vars, name);
  if (!/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value)) {
    throw new Error(`--${name} resolves to "${value}", expected a hex color`);
  }
  const [r, g, b, a] = hexToRgba(value);
  if (a === 1) return value.slice(0, 7).toLowerCase();
  const [br, bg, bb] = hexToRgba(lookup(vars, 'background'));
  return rgbToHex([r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a)]);
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgba(hex)
    .slice(0, 3)
    .map((c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
