# Design System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `apps/web` gets a Supabase-style Tailwind v4 theme (dark default, light, WCAG AA), a shadcn component library covering everything slice 07 needs, a showcase page and a design guide agents read before any UI work.

**Architecture:** Two token layers in `src/app/global.css`: hex scales, then shadcn role variables that point at scale steps, exposed through `@theme inline`. One list of roles and contrast pairs (`src/theme/roles.ts`) drives both a contrast test and the showcase page. Components live in `src/components/ui` (shadcn `base-nova`, Base UI primitives) and are styled with roles only. Four PRs, merged in order.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind v4 (CSS-first), shadcn CLI v4 (`base-nova`), Base UI, Lucide, `next-themes`, `sonner`, Vitest 5 with jsdom and `@testing-library/react`.

**Spec:** `docs/superpowers/specs/2026-11-08-design-system-design.md`

**Linear ticket:** none (this project uses no ticket tracker).

**Branches and PRs** (each branched from `main` after the previous one merges):

| PR  | Branch                        | Tasks |
| --- | ----------------------------- | ----- |
| 1   | `feat/design-system-theme`    | 1–5   |
| 2   | `feat/design-system-forms`    | 6–8   |
| 3   | `feat/design-system-overlays` | 9–10  |
| 4   | `feat/design-system-display`  | 11–15 |

PR 1's branch already carries the spec and this plan.

## Global Constraints

- **Roles only outside `global.css`.** No hex, `rgb(`, `oklch(` or arbitrary color/spacing values (`p-[13px]`, `text-[#…]`) in pages or feature components. Inside `components/ui`, arbitrary values only where no token expresses it. The showcase page may use `style={{ background: 'var(--…)' }}` to render swatches.
- **No raw `<button>`, `<input>`, `<select>`, `<textarea>`** outside `components/ui`.
- **WCAG AA in both modes:** 4.5:1 for text roles, 3:1 for control borders (`--input`), focus rings and icons. Where a kit value fails, move it the smallest step that passes and keep the hue; record original and adjusted value in `DESIGN.md`.
- **Kit values (dark mode)** from the Figma file `aWnbipsr7VQnWEtm5Ewx6P`: background `#1F1F1F`, foreground `#E0E0E0`, muted text `#878787`, secondary text `#BBBBBB`, border `#2A2A2A`, input border `#444444`, checkbox border `#666666`, brand `#3ECF8E`, brand border `#10B981`, primary button `#24B47E`, focus border `#9FE7C7`, warning `#F59E0B`, destructive `#EF4444`, mark `#FFE58F`. Button: radius 4px, 1px border, text 14/20, medium padding 8px × 16px, gap 8px, icon 14px, shadow `0 2px 0 rgb(0 0 0 / 0.05)`, primary text shadow `0 0 4px rgb(38 111 78 / 0.5)`. Input: radius 6px, 1px border, 2px focus border, text 14/20. Checkbox: 14px, radius 4px.
- **Title sizes:** 48/57.6, 36/43.2, 24/32, 18/28, 16/24, weight 400.
- **Radius steps:** `--radius-sm: 4px`, `--radius-md: 6px`, `--radius-lg: 8px`, `--radius-xl: 12px`. `--radius` = 8px; larger steps keep the existing multipliers.
- **Fonts:** Roboto (400, 500, 700) as `--font-sans` and `--font-heading`; Roboto Mono as `--font-mono`. Geist is removed.
- **Theme:** class on `<html>`, default `dark`, themes `light` and `dark` only, no system option, stored per browser by `next-themes` under its default key `theme`.
- **Screens:** desktop-first, and nothing scrolls sideways at 360px wide.
- **Adding shadcn components:** `pnpm --filter @xjobs/web exec shadcn add <names>` (use `--overwrite` only for files this plan says to replace). Then restyle the generated file onto roles.
- **Unit tests:** `cd apps/web && npx vitest run <file>`. No `@testing-library/jest-dom` or `user-event`: use `fireEvent` and plain DOM assertions.
- **Before each PR:** `npx nx run-many -t lint test build typecheck` green, then check `/design` in both themes at desktop width and at 360px. Put both checks in the PR description.
- **Every PR updates `apps/web/DESIGN.md` and the showcase page** with what it adds.
- **No CI checks for the design rules** (maintainer's decision): guidance only.
- **Supabase material is Apache-2.0.** Matching values needs no notice; copying code from `supabase/supabase` keeps its license header and an attribution line in the file.
- **Claude never pushes.** The human pushes each PR.

## Review Focus

1. **Light mode reloads as light.** A user who chose light and reloads gets light, not a forced dark default. Pinned in Task 2.
2. **The showcase is reachable signed out locally and on previews, and 404s in production.** Pinned in Task 4.
3. **Picker search ignores accents and matches aliases**: "zurich" finds "Zürich", "usa" finds "United States" through `keywords`. Pinned in Task 10.
4. **Picker with a long list** (2,000 options) renders at most 50 matches and still finds the last option by typing. Pinned in Task 10.
5. **Drop zone edge cases:** a `.pdf` file with an empty MIME type is accepted; a file of exactly `maxBytes` is accepted and `maxBytes + 1` is rejected. Pinned in Task 13.

---

## PR 1: Theme and guide (`feat/design-system-theme`)

### Task 1: Color scales, roles and the contrast test

**Files:**

- Create: `apps/web/src/theme/roles.ts`, `apps/web/src/theme/theme-css.ts`, `apps/web/src/theme/theme-css.spec.ts`
- Modify: `apps/web/src/app/global.css`

**Interfaces:**

- Produces:
  - `SCALES: readonly ['gray', 'green', 'amber', 'red']`, each with steps 1–12 (`--gray-1` … `--gray-12`).
  - `ROLES: readonly string[]`: every shadcn role already in `global.css` (`background` … `sidebar-ring`, `chart-1..5`) plus `brand`, `success`, `success-foreground`, `warning`, `warning-foreground`, `mark`, `mark-foreground`.
  - `CONTRAST_PAIRS: readonly { fg: string; bg: string; min: 4.5 | 3 }[]`.
  - `parseThemeBlocks(css: string): { light: Record<string, string>; dark: Record<string, string> }` (variables in `:root` and `.dark`).
  - `resolveColor(vars: Record<string, string>, name: string): string` follows `var(--x)` chains to a hex value; an 8-digit hex is composited over the mode's `--background`.
  - `contrastRatio(a: string, b: string): number` (WCAG relative luminance).

- [ ] **Step 1: Write the failing test** `theme-css.spec.ts`, reading `src/app/global.css` from disk:

```ts
it.each(['light', 'dark'] as const)('%s defines every role and scale step', (mode) => {
  const vars = parseThemeBlocks(css)[mode];
  for (const role of ROLES) expect(vars[role], role).toBeDefined();
  for (const s of SCALES) for (let i = 1; i <= 12; i++) expect(vars[`${s}-${i}`]).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/i);
});
it.each(['light', 'dark'] as const)('%s roles point at scales, never literals', (mode) => {
  const vars = parseThemeBlocks(css)[mode];
  for (const role of ROLES) expect(vars[role], role).toMatch(/^var\(--(gray|green|amber|red)-\d+\)$/);
});
it.each(['light', 'dark'] as const)('%s meets AA for every pair', (mode) => {
  const vars = parseThemeBlocks(css)[mode];
  for (const { fg, bg, min } of CONTRAST_PAIRS) expect(contrastRatio(resolveColor(vars, fg), resolveColor(vars, bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(min);
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
```

`CONTRAST_PAIRS` (4.5 unless noted): `foreground/background`, `card-foreground/card`, `popover-foreground/popover`, `primary-foreground/primary`, `secondary-foreground/secondary`, `muted-foreground/background`, `muted-foreground/muted`, `accent-foreground/accent`, `destructive/background`, `brand/background`, `success/background`, `warning/background`, `mark-foreground/mark`, `sidebar-foreground/sidebar`, `sidebar-primary-foreground/sidebar-primary`, `sidebar-accent-foreground/sidebar-accent`; at 3: `input/background`, `ring/background`.

- [ ] **Step 2: Run it and see it fail**

Run: `cd apps/web && npx vitest run src/theme/theme-css.spec.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `roles.ts` and `theme-css.ts`, then rewrite the color part of `global.css`**

Scales hold hex values only, under `:root` (light) and `.dark`, following Supabase's 12-step convention (1–2 app backgrounds, 3–5 component backgrounds, 6–8 borders, 9–10 solid fills, 11–12 text). Place the kit values from Global Constraints on dark steps; take light values and the remaining steps from Supabase's `packages/ui` config in `supabase/supabase`. Every role in both blocks is `var(--<scale>-<n>)`. Add the new roles to `@theme inline` (`--color-brand: var(--brand)` and so on). Where a pair fails, adjust per Global Constraints (expected: the primary button green, `--input`, possibly `--muted-foreground` in light).

- [ ] **Step 4: Run it and see it pass**

Run: `cd apps/web && npx vitest run src/theme/theme-css.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/theme apps/web/src/app/global.css
git commit -m "feat(web): Supabase-style color scales and roles with an AA contrast test"
```

### Task 2: Type, radius, shadows, fonts and theme switching

**Files:**

- Create: `apps/web/src/components/theme-provider.tsx`, `apps/web/src/components/ui/theme-toggle.tsx`, `apps/web/src/components/ui/theme-toggle.spec.tsx`
- Modify: `apps/web/src/app/global.css`, `apps/web/src/app/layout.tsx`, `apps/web/src/theme/theme-css.spec.ts`, `apps/web/package.json`

**Interfaces:**

- Consumes: `parseThemeBlocks` (Task 1).
- Produces:
  - Utilities `text-title-1` … `text-title-5`, `rounded-sm|md|lg|xl` at the pinned radii, `shadow-button`, `text-shadow-brand`, and `shadow-sm|md|lg` set to Supabase's values (used by popovers, menus and dialogs).
  - `ThemeProvider({ children })`: wraps `next-themes` with `attribute="class"`, `defaultTheme="dark"`, `enableSystem={false}`, `themes={['light', 'dark']}`, `disableTransitionOnChange`.
  - `ThemeToggle()`: icon button (Sun/Moon), `aria-label` "Switch to light theme" or "Switch to dark theme".

- [ ] **Step 1: Write the failing tests**

Add to `theme-css.spec.ts` a parse of the `@theme` block: `--text-title-1` is `48px` with `--text-title-1--line-height` `57.6px`, through `--text-title-5` `16px`/`24px`; `--radius-sm` `4px`, `--radius-md` `6px`.

`theme-toggle.spec.tsx`:

```tsx
it('starts dark and switches to light', async () => {
  render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  );
  expect(document.documentElement.classList.contains('dark')).toBe(true);
  fireEvent.click(await screen.findByRole('button', { name: 'Switch to light theme' }));
  await waitFor(() => expect(document.documentElement.classList.contains('light')).toBe(true));
  expect(localStorage.getItem('theme')).toBe('light');
});
it('honours a stored light choice on load', async () => {
  localStorage.setItem('theme', 'light');
  render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  );
  await waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(false));
  expect(await screen.findByRole('button', { name: 'Switch to dark theme' })).toBeTruthy();
});
```

Clear `localStorage` and the `<html>` class in `afterEach`.

- [ ] **Step 2: Run them and see them fail**

Run: `cd apps/web && npx vitest run src/theme src/components/ui/theme-toggle.spec.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

`pnpm --filter @xjobs/web add next-themes`. In `global.css`'s `@theme inline`: title sizes, the four pinned radii, `--shadow-button`, `--text-shadow-brand`, `--font-mono`. In `layout.tsx`: Roboto and Roboto_Mono from `next/font/google` replace Geist, `<html suppressHydrationWarning>`, body wrapped in `ThemeProvider`. Base layer: `body` uses `font-sans` and `text-sm`. Lucide stroke width and default icon size are your call; set them once in the base layer, not per icon.

- [ ] **Step 4: Run them and see them pass**

Same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): Roboto, kit type and radius tokens, dark-default theme toggle"
```

### Task 3: Existing components and screens on the theme

**Files:**

- Modify: `apps/web/src/components/ui/{button,input,input-otp,label}.tsx`, `apps/web/src/app/page.tsx`, `apps/web/src/app/setup/page.tsx`, `apps/web/src/app/sign-in/page.tsx`, `apps/web/src/app/sign-in/sign-in-form.tsx`, `apps/web/src/components/sign-out-button.tsx`

**Interfaces:**

- Consumes: roles and utilities from Tasks 1–2.
- Produces: no new API. Button keeps its current variant and size names until Task 6.

- [ ] **Step 1: Restyle the four components onto roles**

Button: `rounded-sm`, `shadow-button`, `default` variant is the kit primary (`bg-primary`, `border-brand`, `text-shadow-brand`). Replace the `secondary` hover's `color-mix` arbitrary value with a role. Input and OTP slots: `rounded-md`, `border-input`, focus `border-brand`. Remove every non-token class (`text-[0.8rem]` and similar) that a token can express.

- [ ] **Step 2: Move the screens onto tokens**

Headings use `text-title-2` (home) and `text-title-3` (setup, sign-in). Error paragraphs (`role="alert"`) use `text-destructive`. Nothing else in these files may use a non-token class.

- [ ] **Step 3: Verify**

Run: `npx nx run-many -t lint test typecheck -p web`
Expected: all pass. Then `npx nx dev web`, open `/sign-in` in both themes: Roboto, dark `#1F1F1F` background, green primary button.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): move existing components and screens onto the theme"
```

### Task 4: Showcase page

**Files:**

- Create: `apps/web/src/lib/design/showcase.ts`, `apps/web/src/lib/design/showcase.spec.ts`, `apps/web/src/app/design/page.tsx`, `apps/web/src/app/design/_sections/tokens.tsx`, `apps/web/src/app/design/_sections/components.tsx`
- Modify: `apps/web/src/lib/auth/session-policy.ts`, `apps/web/src/lib/auth/session-policy.spec.ts`

**Interfaces:**

- Consumes: `SCALES`, `ROLES` (Task 1), `ThemeToggle` (Task 2).
- Produces: `isShowcaseEnabled(env: { VERCEL_ENV?: string }): boolean`. Later PRs add one section file each under `_sections/` and list it in `page.tsx`.

- [ ] **Step 1: Write the failing tests**

```ts
it('is off only in Vercel production', () => {
  expect(isShowcaseEnabled({ VERCEL_ENV: 'production' })).toBe(false);
  expect(isShowcaseEnabled({ VERCEL_ENV: 'preview' })).toBe(true);
  expect(isShowcaseEnabled({})).toBe(true);
});
```

In `session-policy.spec.ts`: signed out, `/design` returns `{ action: 'continue' }`; `/designer` still redirects to `/sign-in`.

- [ ] **Step 2: Run them and see them fail**

Run: `cd apps/web && npx vitest run src/lib/design src/lib/auth/session-policy.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add `'/design'` to `PUBLIC_PATHS`. `page.tsx` calls `notFound()` when `isShowcaseEnabled(process.env)` is false, and renders the toggle and the sections. `tokens.tsx`: every scale step and every role as swatches with their names, contrast pairs with their ratio (from `contrastRatio`), title sizes, radii, shadows. `components.tsx`: every `components/ui` component in all variants and states. The page works at 360px.

- [ ] **Step 4: Run them and see them pass**

Same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): design showcase page, hidden in production"
```

### Task 5: Design guide and pointers

**Files:**

- Create: `apps/web/DESIGN.md`, `apps/web/CLAUDE.md`
- Modify: `CLAUDE.md` (Conventions), `docs/roadmap/phase-1-accounts-and-preferences/07-guided-setup-ui.md` (Locked)

- [ ] **Step 1: Write `DESIGN.md` v1**

Sections, in this order, short and scannable: **Rules** (the Global Constraints rules, verbatim in substance); **Tokens** (each role: purpose and an example class; type tokens and when to use each; spacing is Tailwind's scale; radii; shadows); **Contrast adjustments** (table: kit value, adjusted value, why); **Components** (a table: component, variants/sizes, use it for, not for); **Adding to the library** (the spec's rule); **Responsive** (desktop-first, check at 360px); **Where to look** (`/design`).

- [ ] **Step 2: Add the pointers**

`apps/web/CLAUDE.md`: "Before any UI work in this app, read `DESIGN.md` and follow it. Build screens only from `src/components/ui` and theme tokens." Root `CLAUDE.md` Conventions: one line pointing at `apps/web/DESIGN.md`. Slice 07 brief, under Locked: "Built only from the design system (`docs/superpowers/specs/2026-11-08-design-system-design.md`); starts after its four PRs merge."

- [ ] **Step 3: Verify and commit**

Run: `npx nx run-many -t lint test build typecheck`
Expected: all green.

```bash
git add apps/web/DESIGN.md apps/web/CLAUDE.md CLAUDE.md docs/roadmap
git commit -m "docs(web): design guide, agent pointers, slice 07 dependency"
```

---

## PR 2: Form controls (`feat/design-system-forms`)

### Task 6: Button, full kit set

**Files:**

- Modify: `apps/web/src/components/ui/button.tsx`
- Create: `apps/web/src/components/ui/button.spec.tsx`, `apps/web/src/components/ui/spinner.tsx` (via shadcn), `apps/web/src/app/design/_sections/buttons.tsx`

**Interfaces:**

- Produces: `Button` props `variant: 'default' | 'secondary' | 'outline' | 'dashed' | 'ghost' | 'link' | 'destructive'`, `size: 'xs' | 'sm' | 'default' | 'lg' | 'xl' | 'icon-xs' | 'icon-sm' | 'icon' | 'icon-lg' | 'icon-xl'`, `loading?: boolean`; icons placed with `data-icon="inline-start" | "inline-end"` as today. `buttonVariants` stays exported.

- [ ] **Step 1: Write the failing test**

```tsx
it('loading disables the button and marks it busy', () => {
  const onClick = vi.fn();
  render(
    <Button loading onClick={onClick}>
      Save
    </Button>,
  );
  const button = screen.getByRole('button', { name: /save/i });
  expect(button.getAttribute('aria-busy')).toBe('true');
  expect((button as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(button);
  expect(onClick).not.toHaveBeenCalled();
});
it('maps kit sizes to heights', () => {
  for (const [size, h] of [
    ['xs', 'h-7'],
    ['sm', 'h-8'],
    ['default', 'h-9'],
    ['lg', 'h-10'],
    ['xl', 'h-12'],
  ] as const)
    expect(buttonVariants({ size })).toContain(h);
});
it('dashed uses a dashed border', () => expect(buttonVariants({ variant: 'dashed' })).toContain('border-dashed'));
```

- [ ] **Step 2: Run it and see it fail**

Run: `cd apps/web && npx vitest run src/components/ui/button.spec.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Kit mapping from the spec (Primary `default`, Default `secondary`, Outline `outline`, Dashed `dashed`, Text `ghost`, Link `link`, plus `destructive`). Medium metrics come from Global Constraints; for the other sizes, read text size and padding from Figma nodes `133:3932` (tiny), `133:3908` (small), `133:3860` (large), `133:3836` (xlarge), or scale proportionally if Figma isn't available to you. Focus-visible ring uses `ring`. `loading` renders `Spinner` in the start icon slot. Add the buttons section to the showcase (every variant × size, icon left/right/only, disabled, loading).

- [ ] **Step 4: Run it and see it pass**, then **commit**

```bash
git add apps/web/src
git commit -m "feat(web): button with the kit's six types and five sizes, loading state"
```

### Task 7: Inputs and choice controls

**Files:**

- Add via shadcn: `textarea`, `checkbox`, `radio-group`, `switch`, `select`, `input-group`
- Modify: `apps/web/src/components/ui/input.tsx`
- Create: `apps/web/src/components/ui/checkbox.spec.tsx`, `apps/web/src/app/design/_sections/inputs.tsx`

- [ ] **Step 1: Write the failing test**: clicking a `Checkbox` with `aria-label="Remember"` flips `aria-checked` from `false` to `true` and calls `onCheckedChange(true)`.
- [ ] **Step 2: Run it and see it fail** (`npx vitest run src/components/ui/checkbox.spec.tsx`).
- [ ] **Step 3: Add and restyle the components.** Input: height `h-9` (matches the default button; the kit's 40px input is the auth card's, rebuilt in Task 15), `rounded-md`, `border-input`, focus `border-brand`. `input-group` supports a leading icon. Checkbox: 14px (`size-3.5`), `rounded-sm`, unchecked `border-input`, hover `border-brand`, checked `bg-brand`. Radio, switch, select and textarea use the same roles. Add the inputs section to the showcase.
- [ ] **Step 4: Run it and see it pass**, then **commit** (`feat(web): inputs, textarea, checkbox, radio, switch, select`).

### Task 8: Field wrapper and the sign-in form on it

**Files:**

- Add via shadcn: `field`
- Create: `apps/web/src/components/ui/field.spec.tsx`, `apps/web/src/app/design/_sections/fields.tsx`
- Modify: `apps/web/src/components/ui/field.tsx`, `apps/web/src/app/sign-in/sign-in-form.tsx`, `apps/web/DESIGN.md`

**Interfaces:**

- Produces: `Field`, `FieldLabel`, `FieldDescription`, `FieldError` (shadcn names). A `Field` with `invalid` wires its control: `aria-invalid="true"` and `aria-describedby` listing the description and error ids.

- [ ] **Step 1: Write the failing test**

```tsx
it('links the error to the control', () => {
  render(
    <Field invalid>
      <FieldLabel htmlFor="email">Email</FieldLabel>
      <Input id="email" />
      <FieldError>Enter a valid email</FieldError>
    </Field>,
  );
  const input = screen.getByLabelText('Email');
  expect(input.getAttribute('aria-invalid')).toBe('true');
  const ids = input.getAttribute('aria-describedby')!.split(' ');
  expect(ids.map((id) => document.getElementById(id)?.textContent)).toContain('Enter a valid email');
});
```

- [ ] **Step 2: Run it and see it fail.**
- [ ] **Step 3: Implement.** Base UI's `Field` can do the wiring; otherwise use a context. Error text uses `text-destructive`. Move the sign-in email and code inputs into `Field`s with their errors. Add the fields section to the showcase, and add the PR's components to `DESIGN.md`.
- [ ] **Step 4: Run it and see it pass**, run the full check, then **commit** (`feat(web): field wrapper with error wiring; sign-in uses it`).

---

## PR 3: Pickers and overlays (`feat/design-system-overlays`)

### Task 9: Overlays, confirm dialog and toasts

**Files:**

- Add via shadcn: `popover`, `tooltip`, `dropdown-menu`, `dialog`, `alert-dialog`, `sonner`
- Create: `apps/web/src/components/ui/confirm-dialog.tsx`, `apps/web/src/components/ui/confirm-dialog.spec.tsx`, `apps/web/src/app/design/_sections/overlays.tsx`
- Modify: `apps/web/src/app/layout.tsx` (mount `Toaster`)

**Interfaces:**

- Produces: `ConfirmDialog({ trigger: React.ReactElement; title: string; description: string; confirmLabel: string; destructive?: boolean; onConfirm: () => void | Promise<void> })`. The confirm button shows `loading` while `onConfirm` is pending and the dialog closes when it resolves; it stays open if it rejects. `toast` from `sonner`, with `Toaster` themed through `next-themes`.

- [ ] **Step 1: Write the failing tests**: confirming calls `onConfirm` once and closes the dialog; cancel doesn't call it; with an `onConfirm` that never resolves, the confirm button has `aria-busy="true"`; a rejecting `onConfirm` leaves the dialog open.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement** on `alert-dialog` and `Button` (Task 6). Dialogs are full-width with a margin below `sm`. Overlays use `popover` and `shadow-lg`. Add the overlays section to the showcase.
- [ ] **Step 4: Run them and see them pass**, then **commit** (`feat(web): overlays, confirm dialog, toasts`).

### Task 10: Searchable single and multi picker

**Files:**

- Add via shadcn: `combobox`
- Create: `apps/web/src/components/ui/picker.tsx`, `apps/web/src/components/ui/picker.spec.tsx`, `apps/web/src/components/ui/picker-filter.ts`, `apps/web/src/components/ui/picker-filter.spec.ts`, `apps/web/src/app/design/_sections/pickers.tsx`

**Interfaces:**

- Produces:
  - `type PickerOption = { value: string; label: string; keywords?: string[] }`
  - `filterOptions(options: PickerOption[], query: string, limit = 50): PickerOption[]` matches label and keywords, ignoring case and accents (NFD, strip combining marks), prefix matches first, then substring, in the original order within each group.
  - `Picker({ id?, options, value: string | null, onValueChange(value: string | null), placeholder, emptyText, disabled?, 'aria-invalid'? })`
  - `MultiPicker({ id?, options, value: string[], onValueChange(value: string[]), placeholder, emptyText, disabled?, 'aria-invalid'? })`: selected values are chips, each with a remove button labelled `Remove <label>`; Backspace in an empty search removes the last chip; selected options don't appear twice.

- [ ] **Step 1: Write the failing tests**

`picker-filter.spec.ts`: `"zurich"` finds `Zürich`; `"usa"` finds `{ label: 'United States', keywords: ['USA'] }`; `"ber"` puts `Berlin` before `Alberta`; 2,000 options with query `""` return 50, and query `"option 1999"` returns that option.

`picker.spec.tsx`: typing "ber" and choosing Berlin calls `onValueChange(['berlin'])`; with value `['berlin']` the chip's `Remove Berlin` button calls `onValueChange([])`; Backspace in the empty input removes the last value; a query with no match shows `emptyText`.

- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement** on the shadcn `combobox` (Base UI Combobox), passing `filterOptions` as its filter. The list scrolls inside a max height and matches the trigger's width; on phones it never exceeds the viewport. Add the pickers section to the showcase with a 250-country example.
- [ ] **Step 4: Run them and see them pass**, update `DESIGN.md` (picker vs select: select for under ~10 fixed options, picker for value lists), run the full check, then **commit** (`feat(web): searchable single and multi picker`).

---

## PR 4: Layout and display (`feat/design-system-display`)

### Task 11: Display components and inline text

**Files:**

- Add via shadcn: `card`, `badge`, `tabs`, `table`, `separator`, `skeleton`, `empty`, `kbd`
- Create: `apps/web/src/components/ui/text.tsx`, `apps/web/src/components/ui/badge.spec.tsx`, `apps/web/src/app/design/_sections/display.tsx`

**Interfaces:**

- Produces: `Badge` variants `default | secondary | outline | success | warning | destructive`; `Code`, `Mark` and `TextLink` (wraps `next/link`, `text-brand underline-offset-4 hover:underline`) in `text.tsx`.

- [ ] **Step 1: Write the failing test**: `badgeVariants({ variant })` for `success`, `warning`, `destructive` contains `text-success`, `text-warning`, `text-destructive`.
- [ ] **Step 2: Run it and see it fail.**
- [ ] **Step 3: Implement.** Status badges are tinted (`bg-<role>/10 text-<role>`). `Code` matches the kit's code style (`font-mono`, `bg-muted`, `border-input`, `rounded-sm`); `Mark` uses `bg-mark text-mark-foreground`. Add the display section to the showcase.
- [ ] **Step 4: Run it and see it pass**, then **commit** (`feat(web): cards, badges, tabs, table, empty state, inline text`).

### Task 12: Step indicator

**Files:**

- Create: `apps/web/src/components/ui/steps.tsx`, `apps/web/src/components/ui/steps.spec.tsx`

**Interfaces:**

- Produces: `Steps({ steps: { id: string; label: string }[]; current: number })`, `current` zero-based.

- [ ] **Step 1: Write the failing test**: with 4 steps and `current={1}`, the list item "Roles" has `aria-current="step"`, the first item is marked complete (its accessible name ends in "(done)"), and the text "Step 2 of 4" is present (the compact form shown below `sm`).
- [ ] **Step 2: Run it and see it fail.**
- [ ] **Step 3: Implement** as an `<ol>`: full labels from `sm` up, "Step N of M · Label" below. Add it to the display section.
- [ ] **Step 4: Run it and see it pass**, then **commit** (`feat(web): step indicator`).

### Task 13: File drop zone

**Files:**

- Create: `apps/web/src/components/ui/file-drop-zone.tsx`, `apps/web/src/components/ui/file-drop-zone.spec.tsx`

**Interfaces:**

- Produces: `FileDropZone({ accept: { mime: string; extension: string }; maxBytes: number; value: File | null; onFileChange(file: File | null): void; onReject(reason: 'type' | 'size' | 'multiple'): void; error?: string; disabled? })`. It doesn't know about resumes; slice 07 passes `{ mime: 'application/pdf', extension: '.pdf' }` and `MAX_RESUME_BYTES` from `src/lib/resume/key.ts`.

- [ ] **Step 1: Write the failing tests** (drop events via `fireEvent.drop(zone, { dataTransfer: { files } })`): a `.txt` file calls `onReject('type')` and not `onFileChange`; `new File([], 'cv.pdf', { type: '' })` is accepted; a file of exactly `maxBytes` is accepted and `maxBytes + 1` gives `onReject('size')`; two files give `onReject('multiple')`; with `value` set, the file name shows and `Remove file` calls `onFileChange(null)`; `error` text renders with `role="alert"`; the zone is a focusable button that opens the hidden file input.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.** Dashed `border-input` zone (the kit's dashed style), `border-brand` while dragging over. Add it to the display section.
- [ ] **Step 4: Run them and see them pass**, then **commit** (`feat(web): file drop zone`).

### Task 14: App shell and flow layout

**Files:**

- Add via shadcn: `sidebar` (brings `sheet`)
- Create: `apps/web/src/components/layout/app-shell.tsx`, `apps/web/src/components/layout/app-nav.tsx`, `apps/web/src/components/layout/app-nav.spec.tsx`, `apps/web/src/components/layout/flow-layout.tsx`, `apps/web/src/app/(app)/layout.tsx`, `apps/web/src/app/(flow)/layout.tsx`
- Move: `src/app/page.tsx` → `src/app/(app)/page.tsx`; `src/app/setup/` → `src/app/(flow)/setup/` (URLs unchanged)

**Interfaces:**

- Produces: `NAV_ITEMS: { href: string; label: string; icon: LucideIcon }[]` (only `Home` at `/` today); `AppNav()` marks the current item with `aria-current="page"` using `usePathname`. `AppShell({ children })`: sidebar plus top bar with `ThemeToggle` and a user menu holding `SignOutButton`. Below `md`, the sidebar is a `Sheet` opened by a menu button. `FlowLayout({ children })`: centered column, logo and `ThemeToggle`, no sidebar.

- [ ] **Step 1: Write the failing test**: with `usePathname` mocked to `/`, the Home link has `aria-current="page"`.
- [ ] **Step 2: Run it and see it fail.**
- [ ] **Step 3: Implement** and move the routes. Run `npx nx run-many -t test typecheck -p web` to confirm the moves broke no imports.
- [ ] **Step 4: Run it and see it pass.** At 360px, `/` shows the menu button and the drawer opens and closes; `/setup` shows no sidebar. **Commit** (`feat(web): app shell with mobile drawer, focused flow layout`).

### Task 15: Sign-in on the kit's auth card, guide final pass

**Files:**

- Modify: `apps/web/src/app/sign-in/page.tsx`, `apps/web/src/app/sign-in/sign-in-form.tsx`, `apps/web/DESIGN.md`

- [ ] **Step 1: Rebuild the sign-in page** after the kit's auth card (node `98:552`): a `Card` centered at `max-w-sm`, labels above inputs, email input with a leading `Mail` icon in an `input-group`, full-width primary `Button` size `lg`, links as `TextLink`. The flow (email, then code) doesn't change.
- [ ] **Step 2: Finish `DESIGN.md`**: every component from PRs 2–4 in the components table; layouts (`AppShell` for signed-in pages, `FlowLayout` for multi-step flows); `Steps`, `FileDropZone` and `Picker` usage notes for slice 07.
- [ ] **Step 3: Verify**: full check green; `/sign-in`, `/` and `/design` in both themes at desktop and at 360px.
- [ ] **Step 4: Commit** (`feat(web): sign-in on the auth card; design guide complete`).
