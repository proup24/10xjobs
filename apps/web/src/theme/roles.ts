export const SCALES = ['gray', 'green', 'amber', 'red'] as const;

export const ROLES = [
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'primary-hover',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'destructive',
  'border',
  'input',
  'ring',
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
  'sidebar',
  'sidebar-foreground',
  'sidebar-primary',
  'sidebar-primary-foreground',
  'sidebar-accent',
  'sidebar-accent-foreground',
  'sidebar-border',
  'sidebar-ring',
  'brand',
  'success',
  'success-foreground',
  'warning',
  'warning-foreground',
  'success-text',
  'warning-text',
  'destructive-text',
  'mark',
  'mark-foreground',
] as const;

export type ContrastPair = { fg: string; bg: string; min: 4.5 | 3 };

export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  { fg: 'foreground', bg: 'background', min: 4.5 },
  { fg: 'card-foreground', bg: 'card', min: 4.5 },
  { fg: 'popover-foreground', bg: 'popover', min: 4.5 },
  { fg: 'primary-foreground', bg: 'primary', min: 4.5 },
  // Primary button hover (a solid step, not an alpha of primary).
  { fg: 'primary-foreground', bg: 'primary-hover', min: 4.5 },
  { fg: 'secondary-foreground', bg: 'secondary', min: 4.5 },
  { fg: 'muted-foreground', bg: 'background', min: 4.5 },
  // Also the inactive tab label on the tabs list.
  { fg: 'muted-foreground', bg: 'muted', min: 4.5 },
  { fg: 'accent-foreground', bg: 'accent', min: 4.5 },
  { fg: 'destructive', bg: 'background', min: 4.5 },
  // Also the link button and in-text link hovers.
  { fg: 'brand', bg: 'background', min: 4.5 },
  { fg: 'success', bg: 'background', min: 4.5 },
  { fg: 'warning', bg: 'background', min: 4.5 },
  { fg: 'mark-foreground', bg: 'mark', min: 4.5 },
  { fg: 'sidebar-foreground', bg: 'sidebar', min: 4.5 },
  { fg: 'sidebar-primary-foreground', bg: 'sidebar-primary', min: 4.5 },
  { fg: 'sidebar-accent-foreground', bg: 'sidebar-accent', min: 4.5 },
  { fg: 'input', bg: 'background', min: 3 },
  { fg: 'ring', bg: 'background', min: 3 },
  // Focus outlines and field focus borders also sit on cards and popovers.
  { fg: 'ring', bg: 'card', min: 3 },
  { fg: 'ring', bg: 'popover', min: 3 },
];

/**
 * Pairs whose background is a tint: `bg` at `alpha` (per mode) composited
 * over `--background`, as Tailwind's `bg-<role>/<n>` renders it. Kept apart
 * from CONTRAST_PAIRS because the showcase reads live computed styles and
 * cannot resolve a tint from one variable; `theme-css.spec.ts` covers both.
 */
export type CompositePair = {
  use: string;
  fg: string;
  bg: string;
  alpha: { light: number; dark: number };
  min: 4.5 | 3;
};

export const COMPOSITE_PAIRS: readonly CompositePair[] = [
  {
    use: 'destructive button and menu item, rest',
    fg: 'destructive-text',
    bg: 'destructive',
    alpha: { light: 0.1, dark: 0.2 },
    min: 4.5,
  },
  {
    use: 'destructive button, hover',
    fg: 'destructive-text',
    bg: 'destructive',
    alpha: { light: 0.2, dark: 0.3 },
    min: 4.5,
  },
  {
    use: 'field focus border on the field fill (transparent in light)',
    fg: 'ring',
    bg: 'input',
    alpha: { light: 0, dark: 0.3 },
    min: 3,
  },
];
