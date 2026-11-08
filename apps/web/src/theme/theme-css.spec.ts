import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONTRAST_PAIRS, ROLES, SCALES } from './roles';
import {
  contrastRatio,
  parseThemeBlocks,
  parseThemeInline,
  resolveColor,
} from './theme-css';

const css = readFileSync(join(__dirname, '..', 'app', 'global.css'), 'utf8');

describe('theme css', () => {
  it.each(['light', 'dark'] as const)(
    '%s defines every role and scale step',
    (mode) => {
      const vars = parseThemeBlocks(css)[mode];
      for (const role of ROLES) expect(vars[role], role).toBeDefined();
      for (const s of SCALES)
        for (let i = 1; i <= 12; i++)
          expect(vars[`${s}-${i}`]).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/i);
    },
  );

  it.each(['light', 'dark'] as const)(
    '%s roles point at scales, never literals',
    (mode) => {
      const vars = parseThemeBlocks(css)[mode];
      for (const role of ROLES)
        expect(vars[role], role).toMatch(
          /^var\(--(gray|green|amber|red)-\d+\)$/,
        );
    },
  );

  it.each(['light', 'dark'] as const)('%s meets AA for every pair', (mode) => {
    const vars = parseThemeBlocks(css)[mode];
    for (const { fg, bg, min } of CONTRAST_PAIRS)
      expect(
        contrastRatio(resolveColor(vars, fg), resolveColor(vars, bg)),
        `${fg} on ${bg}`,
      ).toBeGreaterThanOrEqual(min);
  });

  it('dark keeps the kit surface and text', () => {
    const dark = parseThemeBlocks(css).dark;
    expect(resolveColor(dark, 'background').toLowerCase()).toBe('#1f1f1f');
    expect(resolveColor(dark, 'foreground').toLowerCase()).toBe('#e0e0e0');
  });

  it('contrastRatio matches known values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 1);
  });

  it('resolveColor composites 8-digit hex over the background', () => {
    expect(resolveColor({ background: '#000000', x: '#ffffff80' }, 'x')).toBe(
      '#808080',
    );
  });

  it('defines the kit type scale, pinned radii and shadows in @theme inline', () => {
    const t = parseThemeInline(css);
    const titles = [
      ['48px', '57.6px'],
      ['36px', '43.2px'],
      ['24px', '32px'],
      ['18px', '28px'],
      ['16px', '24px'],
    ];
    titles.forEach(([size, lh], i) => {
      expect(t[`text-title-${i + 1}`]).toBe(size);
      expect(t[`text-title-${i + 1}--line-height`]).toBe(lh);
    });
    expect(t['radius-sm']).toBe('4px');
    expect(t['radius-md']).toBe('6px');
    expect(t['radius-lg']).toBe('8px');
    expect(t['radius-xl']).toBe('12px');
    expect(t['shadow-button']).toBe('0 2px 0 rgb(0 0 0 / 0.05)');
    expect(t['text-shadow-brand']).toBe('0 0 4px rgb(38 111 78 / 0.5)');
    expect(t['shadow-sm']).toBeDefined();
    expect(t['shadow-md']).toBeDefined();
    expect(t['shadow-lg']).toBeDefined();
  });
});
