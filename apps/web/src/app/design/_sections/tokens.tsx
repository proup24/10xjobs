'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { CONTRAST_PAIRS, ROLES, SCALES } from '@/theme/roles';
import { contrastRatio } from '@/theme/theme-css';

const STEPS = Array.from({ length: 12 }, (_, i) => i + 1);
const TITLES = [1, 2, 3, 4, 5] as const;
const TITLE_CLASS = {
  1: 'text-title-1',
  2: 'text-title-2',
  3: 'text-title-3',
  4: 'text-title-4',
  5: 'text-title-5',
} as const;
const RADII = ['sm', 'md', 'lg', 'xl'] as const;
const RADIUS_CLASS = {
  sm: 'rounded-sm',
  md: 'rounded-md',
  lg: 'rounded-lg',
  xl: 'rounded-xl',
} as const;
const SHADOWS = ['sm', 'md', 'lg', 'button'] as const;
const SHADOW_CLASS = {
  sm: 'shadow-sm',
  md: 'shadow-md',
  lg: 'shadow-lg',
  button: 'shadow-button',
} as const;

function Swatch({ name }: { name: string }) {
  return (
    <div className="flex flex-col gap-1 text-xs">
      <div
        className="h-10 rounded-md border border-border"
        style={{ background: `var(--${name})` }}
      />
      <span className="break-all text-muted-foreground">{name}</span>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-title-3">{title}</h2>
      {children}
    </section>
  );
}

/** Hex from a computed custom property; an 8-digit hex is composited over the background. */
function readHex(style: CSSStyleDeclaration, name: string): string {
  const value = style.getPropertyValue(`--${name}`).trim().toLowerCase();
  if (!/^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(value)) return '';
  if (value.length === 7) return value;
  const alpha = parseInt(value.slice(7, 9), 16) / 255;
  const bg = style.getPropertyValue('--background').trim().toLowerCase();
  const chan = (hex: string, i: number) =>
    parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const out = [0, 1, 2].map((i) => {
    const base = /^#[0-9a-f]{6}/.test(bg) ? chan(bg, i) : 0;
    const mixed = Math.round(chan(value, i) * alpha + base * (1 - alpha));
    return mixed.toString(16).padStart(2, '0');
  });
  return `#${out.join('')}`;
}

type Row = { fg: string; bg: string; min: number; ratio: number | null };

function useContrastRows(): Row[] {
  const { resolvedTheme } = useTheme();
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    // Read after the theme class is applied to <html>.
    const frame = requestAnimationFrame(() => {
      const style = getComputedStyle(document.documentElement);
      setRows(
        CONTRAST_PAIRS.map(({ fg, bg, min }) => {
          const a = readHex(style, fg);
          const b = readHex(style, bg);
          return { fg, bg, min, ratio: a && b ? contrastRatio(a, b) : null };
        }),
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [resolvedTheme]);
  return rows;
}

export function TokensSection() {
  const rows = useContrastRows();
  return (
    <>
      <Section title="Scales">
        <div className="flex flex-col gap-4">
          {SCALES.map((scale) => (
            <div key={scale} className="flex flex-col gap-2">
              <h3 className="text-title-5">{scale}</h3>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(5rem,1fr))] gap-3">
                {STEPS.map((step) => (
                  <Swatch key={step} name={`${scale}-${step}`} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Roles">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-3">
          {ROLES.map((role) => (
            <Swatch key={role} name={role} />
          ))}
        </div>
      </Section>

      <Section title="Contrast">
        <p className="text-sm text-muted-foreground">
          Computed for the current theme. Text needs 4.5, borders and rings 3.
        </p>
        <ul className="flex flex-col gap-1 text-sm">
          {rows.map(({ fg, bg, min, ratio }) => (
            <li
              key={`${fg}-${bg}`}
              className="flex flex-wrap items-baseline justify-between gap-x-4 border-b border-border py-1"
            >
              <span className="break-all">
                {fg} on {bg}
              </span>
              <span
                className={
                  ratio !== null && ratio < min
                    ? 'text-destructive'
                    : 'text-success'
                }
              >
                {ratio === null ? 'n/a' : ratio.toFixed(2)} (min {min})
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Type">
        <div className="flex flex-col gap-2">
          {TITLES.map((n) => (
            <p key={n} className={`${TITLE_CLASS[n]} break-words`}>
              title-{n} Senior engineer
            </p>
          ))}
        </div>
      </Section>

      <Section title="Radius">
        <div className="flex flex-wrap gap-4">
          {RADII.map((r) => (
            <div key={r} className="flex flex-col items-center gap-1 text-xs">
              <div
                className={`size-16 border border-border bg-muted ${RADIUS_CLASS[r]}`}
              />
              radius-{r}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Shadows">
        <div className="flex flex-wrap gap-6">
          {SHADOWS.map((s) => (
            <div key={s} className="flex flex-col items-center gap-2 text-xs">
              <div
                className={`size-16 rounded-md border border-border bg-card ${SHADOW_CLASS[s]}`}
              />
              shadow-{s}
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}
