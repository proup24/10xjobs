// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Source checks for the focus and contrast recipes in DESIGN.md "Rules".
const dir = import.meta.dirname;
const source = (file: string) => readFileSync(join(dir, file), 'utf8');
const components = readdirSync(dir).filter(
  (f) => f.endsWith('.tsx') && !f.includes('.spec.'),
);
/** Every string literal in a file, so recipes are checked per class list. */
const literals = (file: string) =>
  [...source(file).matchAll(/(["'`])((?:(?!\1)[^\\]|\\.)*)\1/g)].map(
    (m) => m[2],
  );

const OUTLINE = [
  'focus-visible:outline-2',
  'focus-visible:outline-offset-2',
  'focus-visible:outline-ring',
];

describe('focus recipe', () => {
  it('no component uses a low-alpha halo or a ring as its focus indicator', () => {
    const halo =
      /(focus-visible|focus-within|has-\[:focus-visible\]|data-\[active=true\]):(ring-(2|3|\[3px\])|ring-(brand|ring|destructive)\/\d+|border-brand|border-destructive\/)|ring-brand\/30|ring-ring\/50/;
    for (const file of components)
      for (const text of literals(file))
        expect(text.match(halo)?.[0], file).toBeUndefined();
  });

  it.each(['badge.tsx', 'tabs.tsx', 'text.tsx', 'sidebar.tsx'])(
    '%s clickables use the solid outline and never hide it',
    (file) => {
      const lists = literals(file).filter((t) =>
        t.includes('focus-visible:outline-2'),
      );
      expect(lists.length, file).toBeGreaterThan(0);
      for (const list of lists) {
        const classes = list.split(/\s+/);
        for (const c of OUTLINE) expect(classes, file).toContain(c);
        expect(classes, file).not.toContain('outline-none');
        expect(classes, file).not.toContain('outline-hidden');
      }
    },
  );

  it.each([
    ['input.tsx', 'focus-visible'],
    ['textarea.tsx', 'focus-visible'],
    ['select.tsx', 'focus-visible'],
    ['checkbox.tsx', 'focus-visible'],
    ['radio-group.tsx', 'focus-visible'],
    ['switch.tsx', 'focus-visible'],
    ['input-group.tsx', 'has-[[data-slot=input-group-control]:focus-visible]'],
    ['combobox.tsx', 'focus-within'],
    ['input-otp.tsx', 'data-[active=true]'],
    ['field.tsx', 'has-[>[data-slot=field]]:has-[:focus-visible]'],
  ])('%s fields show a solid 2px focus border in ring', (file, on) => {
    const text = source(file);
    for (const c of ['border-ring', 'ring-1', 'ring-ring'])
      expect(text, file).toContain(`${on}:${c}`);
  });
});

describe('composed-state colors', () => {
  it('tabs label inactive triggers with muted-foreground', () => {
    const text = source('tabs.tsx');
    expect(text).toContain('text-muted-foreground');
    expect(text).not.toContain('text-foreground/60');
  });

  it('the destructive menu item uses destructive-text', () => {
    const text = source('dropdown-menu.tsx');
    expect(text).toContain('data-[variant=destructive]:text-destructive-text');
    expect(text).not.toMatch(/:text-destructive(?![-\w])/);
  });

  it.each(['empty.tsx', 'field.tsx'])('%s link hover uses brand', (file) => {
    const text = source(file);
    expect(text).toContain('[&>a:hover]:text-brand');
    expect(text).not.toContain('[&>a:hover]:text-primary');
  });

  it('the multi-picker input is 16px on small screens (no iOS zoom)', () => {
    const list = literals('combobox.tsx').find((t) =>
      t.startsWith('h-7 min-w-16'),
    );
    expect(list?.split(' ')).toEqual(
      expect.arrayContaining(['text-base', 'md:text-sm']),
    );
  });

  it('every floating surface uses shadow-lg', () => {
    for (const file of components)
      expect(source(file).includes('shadow-md'), file).toBe(false);
  });
});
