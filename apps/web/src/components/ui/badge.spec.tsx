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
      const classes = cls.split(' ');
      expect(classes).toContain(`text-${variant}-text`);
      expect(classes).toContain(`bg-${variant}/10`);
      expect(cls).not.toContain('dark:text-');
      expect(cls).not.toContain('color-mix');
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
        const base = resolveColor(vars, role);
        const fg = resolveColor(vars, `${role}-text`);
        const ratio = contrastRatio(fg, tint(base, background, 0.1));
        expect(ratio, `${role} ${mode}`).toBeGreaterThanOrEqual(4.5);
      }
    },
  );
});
