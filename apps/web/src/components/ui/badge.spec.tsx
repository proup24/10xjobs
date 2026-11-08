import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { badgeVariants } from './badge';
import {
  contrastRatio,
  parseThemeBlocks,
  resolveColor,
} from '../../theme/theme-css';

const css = readFileSync(
  join(__dirname, '..', '..', 'app', 'global.css'),
  'utf8',
);

function hexToRgb(hex: string): number[] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

function tint(fg: string, bg: string, alpha: number): string {
  const f = hexToRgb(fg);
  const b = hexToRgb(bg);
  return `#${f
    .map((c, i) =>
      Math.round(c * alpha + b[i] * (1 - alpha))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

describe('badgeVariants', () => {
  it.each(['success', 'warning', 'destructive'] as const)(
    '%s is a tinted status badge',
    (variant) => {
      const cls = badgeVariants({ variant });
      expect(cls).toContain(`text-${variant}`);
      expect(cls).toContain(`bg-${variant}/10`);
      expect(cls).toContain(`dark:text-${variant}`);
    },
  );

  it.each(['default', 'secondary', 'outline'] as const)(
    'has the %s variant',
    (variant) => {
      expect(badgeVariants({ variant })).toBeTruthy();
    },
  );

  it.each(['light', 'dark'] as const)(
    '%s status text keeps AA over its tint',
    (mode) => {
      const vars = parseThemeBlocks(css)[mode];
      const background = resolveColor(vars, 'background');
      for (const role of ['success', 'warning', 'destructive']) {
        // Light mode darkens the text 25% toward black (see badge.tsx); dark mode uses the role as is.
        const base = resolveColor(vars, role);
        const fg =
          mode === 'light'
            ? `#${hexToRgb(base)
                .map((c) =>
                  Math.round(c * 0.75)
                    .toString(16)
                    .padStart(2, '0'),
                )
                .join('')}`
            : base;
        const ratio = contrastRatio(fg, tint(base, background, 0.1));
        console.log(`${mode} ${role} ${ratio.toFixed(2)}`);
        expect(ratio, `${role} ${mode}`).toBeGreaterThanOrEqual(4.5);
      }
    },
  );
});
