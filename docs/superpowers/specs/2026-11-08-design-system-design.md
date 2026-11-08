# Design system: Supabase-style theme and component library

Date: 2026-11-08
Status: approved
Figma source: [Supabese UI (Community)](https://www.figma.com/design/aWnbipsr7VQnWEtm5Ewx6P/Supabese-UI--Community-), a community library file

## Intent

Give `apps/web` one design language before the Phase 1 UI slices (07 guided setup, 08 edit preferences) are built. Every color, radius, shadow and font size lives in the Tailwind theme as a named token. Every UI element comes from one shadcn-based library in `apps/web/src/components/ui`. Agents building screens compose from those and never invent values or one-off components.

The look is Supabase's. It starts from the Figma kit and goes past it wherever the kit stops. Slice 07's brief leaves "the component and styling baseline" open; this spec is that baseline.

## Why

Without a shared library and written rules, each agent that builds a screen picks its own colors, spacing and button styles. The result is redundant components and a UI that drifts. The fix the maintainer chose is **clear written instructions** backed by a complete library, not CI enforcement.

## Goals

- A Tailwind v4 theme that carries the Supabase look in dark and light, with dark as the default.
- The kit's values reproduced where the kit defines them: surfaces, greens, grays, button types and sizes, heading sizes, input and checkbox.
- The gaps the kit leaves filled in Supabase's style: full color scales, light mode, radius, shadows, body text sizes, and every component the Phase 1 screens need.
- A design guide that every agent working in `apps/web` reads, saying which tokens and components exist, when to use each, and what's forbidden.
- A page in the app that shows every token and component, so people and agents can see what exists.
- WCAG AA contrast in both modes, staying as close to the kit as that allows.
- Desktop-first, and every component usable on a phone. Dialogs, pickers, menus and the step indicator have a small-screen layout, and the showcase page can be checked at phone width.
- The existing components and screens moved onto the new theme, not left beside it.

## Non-goals

- CI or lint enforcement of the rules. Guidance only (maintainer's decision).
- Figma Code Connect. It needs a paid Figma org plan, and from here on the code is the source of truth. _(my call)_
- Pushing anything back into Figma.
- Every shadcn component. The library grows from what Phase 1 screens need. Later additions follow the guide's "add to the library" rule.
- Building slice 07 or 08 screens.

## Anti-goals

- Hex, rgb or oklch values, or arbitrary Tailwind values (`p-[13px]`, `text-[#3ECF8E]`), in pages or feature components.
- Two components that do the same job, or a page-level copy of something in `components/ui`.
- A theme that only works in one mode: every token has a dark and a light value.
- Branding the app as Supabase. The look is borrowed; the name, logo and copy stay 10xjobs.

## Decisions

| Question                  | Decision                                                                                                                                                                                                                                                                                                                                                                   | Whose                               |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Visual target             | Supabase's overall look, starting from the Figma kit; we extend beyond the kit.                                                                                                                                                                                                                                                                                            | maintainer                          |
| Reference for the gaps    | Supabase's open-source UI in the `supabase/supabase` GitHub repo (Apache-2.0), mainly `packages/ui` and its Tailwind config: color scales, light theme, radius, component styling.                                                                                                                                                                                         | my call                             |
| Themes                    | Dark and light. Dark is the default. Users can switch, and the choice persists.                                                                                                                                                                                                                                                                                            | maintainer                          |
| Font                      | Roboto for UI text, replacing Geist. Roboto Mono for code.                                                                                                                                                                                                                                                                                                                 | maintainer (Roboto); my call (mono) |
| Enforcement               | Written guidance only. No CI failures.                                                                                                                                                                                                                                                                                                                                     | maintainer                          |
| Component base            | Stay on the current shadcn setup: style `base-nova` (Base UI primitives), CSS variables, Lucide icons. Supabase uses Radix, but switching primitives buys nothing here.                                                                                                                                                                                                    | my call                             |
| Icons                     | Lucide (already installed). The kit's icon set is a thin line style close to Lucide; the stroke width is tuned to match the kit's thinner line.                                                                                                                                                                                                                            | my call                             |
| Spacing                   | Tailwind's built-in 4px spacing scale is the spacing token set. The kit defines no spacing.                                                                                                                                                                                                                                                                                | my call                             |
| Slicing                   | Four PRs: theme and guide; form controls; pickers and overlays; layout and display. Each updates the guide and the showcase page.                                                                                                                                                                                                                                          | maintainer                          |
| Order against the roadmap | All four slices land before slice 07 starts.                                                                                                                                                                                                                                                                                                                               | my call                             |
| Contrast                  | WCAG AA in both modes: 4.5:1 for normal text, 3:1 for large text, icons, borders of controls and focus rings. Where a kit value fails, move it the smallest step that passes and keep the hue (e.g. darken the primary button green rather than change its text color, whichever stays closer to the kit). The guide records each adjusted value next to the kit original. | maintainer                          |
| Screen sizes              | Desktop-first, mobile-friendly. Designed at desktop widths, and every component and the shell also work on a phone (down to 360px wide) with no horizontal scroll.                                                                                                                                                                                                         | maintainer                          |
| Theme persistence         | Per browser (cookie or localStorage), not per account: no schema change, and it works on `/sign-in`. The toggle offers light and dark only, no "follow the OS".                                                                                                                                                                                                            | my call                             |
| Setup flow layout         | Guided setup renders as a focused full-screen flow outside the app shell, as Supabase does onboarding. The shell's sidebar lists only routes that exist.                                                                                                                                                                                                                   | my call                             |
| Sign-in page              | Re-themed in slice 1; rebuilt to match the kit's auth card (node `98:552`) in slice 4, once Card exists.                                                                                                                                                                                                                                                                   | my call                             |

## Token architecture

Two layers, both in `apps/web/src/app/global.css`:

1. **Scales** (primitive values). Twelve-step scales on Supabase's (Radix-style) step convention: `gray`, `green` (brand), `amber` (warning), `red` (destructive), each with a dark and a light set. Only the scales layer contains literal color values. The kit's values are pinned to steps in the dark set, for example `#1F1F1F` (`black/main`) as the app surface, `#2A2A2A` as button border, `#3ECF8E` and `#2C9C6A` as brand steps. The builder picks the step each kit value occupies and derives the rest from Supabase's scales.
2. **Roles** (what components use). shadcn's role variables (`--background`, `--foreground`, `--card`, `--popover`, `--primary`, `--secondary`, `--muted`, `--accent`, `--destructive`, `--border`, `--input`, `--ring`, `--chart-*`, `--sidebar-*`) each point at a scale step, for both modes. Added roles the kit needs and shadcn lacks: `--success`, `--warning`, `--mark` (highlight), each with a `-foreground`. All roles are exposed to Tailwind through `@theme inline`, so components use `bg-primary`, `text-warning` and so on.

Components and pages use **roles only**. Scales are referenced directly only in `global.css`.

### Kit values to carry over

Read exact values from the Figma file (session fileKey `aWnbipsr7VQnWEtm5Ewx6P`). Variables found on the Colors frame:

| Kit variable                                              | Value                     | Likely role                                      |
| --------------------------------------------------------- | ------------------------- | ------------------------------------------------ |
| `black/main`                                              | #1F1F1F                   | dark background / surface                        |
| `black/buttonBorder`                                      | #2A2A2A                   | dark border                                      |
| `white`                                                   | #FFFFFF                   | primary button text                              |
| `gray/text`                                               | #E0E0E0                   | dark foreground                                  |
| `gray/textSecandary`                                      | #878787                   | dark muted foreground                            |
| `gray/buttonText`                                         | #BBBBBB                   | secondary button text, labels                    |
| `gray/666666`, `gray/codeBorder`, `gray/inputBorder`      | #666666, #646464, #444444 | input border, code border                        |
| `gray/textBackground`                                     | #969696                   | (check use in file)                              |
| `green/main`, `green/inputBackground`, `green/buttonText` | #10B981, #3ECF8E, #24B47E | brand, link, focus                               |
| `green/dark`, `green/buttonBackground`                    | #2C9C6A                   | primary button background                        |
| `green/textShadow`                                        | #266F4E                   | primary button text shadow (50% alpha, 4px blur) |
| `green/inputBorder`                                       | #9FE7C7                   | input focus border                               |
| `orange`, `red`, `yellow`                                 | #F59E0B, #EF4444, #FFE58F | warning, destructive, mark                       |

The "likely role" column is a starting guess for the builder, not a decision.

Figma nodes to read: Colors `108:546`, Typography `108:473`, Text styles `11:771`, Buttons `133:3213`, Input and checkbox `96:1204`, Auth card `98:552`, Icons page `119:3659`.

### Type

- Roboto via `next/font/google`, bound to `--font-sans` (and `--font-heading`). Roboto Mono bound to `--font-mono`.
- The kit's five title sizes become theme tokens `--text-title-1` … `--text-title-5` (48/57.6, 36/43.2, 24/32, 18/28, 16/24, regular weight), used as `text-title-1` etc. The token names are the builder's call as long as the guide documents them.
- Body and small sizes: Tailwind's `text-base`/`text-sm`/`text-xs`, with Supabase's dashboard density as the reference (14px body). Weights: regular, medium, and bold for "strong".

### Radius, shadows

- `--radius` set to Supabase's value; the existing derived `--radius-*` steps stay.
- Shadows: a small set (`sm`, `md`, `lg` for popovers and dialogs) in Supabase's style, plus the primary button's green text shadow from the kit.

### Theme switching

- `class` strategy on `<html>`, matching the existing `@custom-variant dark`. Default dark. The user's choice persists in the browser across visits without a flash of the wrong theme on load. A small library (for example `next-themes`) is fine.
- A theme toggle component. It lives on the showcase page from slice 1 and in the app shell from slice 4.

## The design guide

- `apps/web/DESIGN.md`, written in slice 1 and updated by every slice after it.
- Agents find it from two places: a new `apps/web/CLAUDE.md` that says to read `DESIGN.md` before any UI work, and one line in the root `CLAUDE.md` Conventions. _(my call)_
- Content:
  - **Tokens:** every role, what it's for, and an example class. Type tokens and when to use each. Spacing is Tailwind's scale. Kit values adjusted for contrast, with the original beside each.
  - **Responsive:** design desktop-first, then check at phone width; which components change shape on small screens.
  - **Components:** each component in `components/ui`, its variants and sizes, and when to use it instead of its neighbors (e.g. dialog vs confirm dialog, select vs picker).
  - **Hard rules:** no literal colors or arbitrary values in pages or feature components; no raw `<button>`, `<input>`, `<select>`, `<textarea>` outside `components/ui`; use an existing component before writing a new one; use roles, never scale steps.
  - **Adding to the library:** if something is missing, add it to `components/ui` (through the shadcn CLI when shadcn has it), theme it with roles, add it to the showcase page and the guide, then use it. Never inline it in a page.
  - **Inside `components/ui`:** arbitrary values are tolerated only where a role or scale can't express it (shadcn's generated code has a few); prefer tokens.
  - **Where to look:** the showcase page.
- Short and scannable. It's read by agents at the start of every UI task.

## Showcase page

- A route in `apps/web` (for example `/design`) showing every token (scales, roles in both modes, type, radius, shadows) and every component in all variants, sizes and states, with the theme toggle.
- Available locally and on Vercel previews, and returns 404 in production. Needs no sign-in, so `src/proxy.ts` must let it through. Shows no user data.
- Each slice adds its components to it.

## Slices

Each slice is one PR to `main`, and each ends with the guide and the showcase page updated.

### 1. Theme and guide

- Token architecture above: scales, roles (dark and light), type, radius, shadows. Replaces the current neutral shadcn defaults in `global.css`.
- Roboto and Roboto Mono replace Geist in `src/app/layout.tsx`.
- Theme switching and the toggle.
- Restyle the existing `button`, `input`, `input-otp`, `label` onto the new roles (the button's full variant set is slice 2).
- Move the existing screens (`/`, `/sign-in`, `/setup`, and the sign-out button) onto the theme, removing any styling that bypasses it.
- Showcase page, first version.
- `apps/web/DESIGN.md` v1, `apps/web/CLAUDE.md`, root `CLAUDE.md` pointer.

### 2. Form controls

- **Button** with all six kit types and five kit sizes, mapped onto shadcn's names so generated shadcn components that use `buttonVariants` keep working _(my call)_:

  | Kit type | Variant        |     | Kit size | Size       | Height |
  | -------- | -------------- | --- | -------- | ---------- | ------ |
  | Primary  | `default`      |     | tiny     | `xs`       | 28px   |
  | Default  | `secondary`    |     | small    | `sm`       | 32px   |
  | Outline  | `outline`      |     | medium   | `default`  | 36px   |
  | Dashed   | `dashed` (new) |     | large    | `lg`       | 40px   |
  | Text     | `ghost`        |     | xlarge   | `xl` (new) | 48px   |
  | Link     | `link`         |     |          |            |        |

  Plus `destructive` (not in the kit). Icon left, right or alone, with matching `icon-*` sizes. States the kit lacks: disabled, focus-visible, loading (spinner, blocks clicks).

- Input (kit normal and focus states, with leading icon support as in the auth card), textarea, checkbox (kit states), radio group, switch, select.
- A field wrapper: label, control, hint text, error message, and required/invalid wiring (shadcn's `field` component is the expected starting point).

### 3. Pickers and overlays

- Popover, tooltip, dropdown menu.
- A searchable picker in single and multi-select forms, for slice 07's value lists (techs, roles, countries, cities and so on). Multi-select shows chosen items as removable chips. Built on shadcn's combobox where it covers this.
- Dialog and confirm dialog (destructive confirm for deleting a draft).
- Toasts.

### 4. Layout and display

- Card, badge (including the status tones success, warning, destructive, neutral), tabs, table, separator, skeleton, empty state.
- Inline text helpers the kit defines: code, keyboard key, mark. Link styling.
- A step indicator for multi-step flows.
- A file drop zone (single file, shows the chosen file and errors) for the resume step.
- The app shell: sidebar navigation and top bar, with the theme toggle, in the Supabase dashboard pattern. On small screens the sidebar collapses into a slide-out drawer (a Sheet component, added to the library). Applied to the signed-in screens that exist; guided setup stays outside it.
- A focused full-screen layout for multi-step flows like setup, without the shell.
- The sign-in page rebuilt on the kit's auth card.

## Constraints

- Tailwind v4 with CSS-first config (`@theme` in `global.css`); there is no `tailwind.config`. shadcn CLI v4, `components.json` aliases unchanged.
- `npx nx run-many -t lint test build typecheck` stays green. Prettier formats edited files.
- Any third-party code or values taken from Supabase's repo keep its Apache-2.0 terms (attribution where code is copied, not where only values are matched).

## Left to the builder

- Exact scale steps, how kit values are placed on them, and the light-mode values.
- The exact Supabase radius and shadow values.
- Token names beyond shadcn's roles, as long as the guide documents them.
- Lucide stroke width and default icon size.
- How the showcase page is hidden in production.
- Tests for components (behavior worth testing, such as the picker and the drop zone; no visual regression suite required).
- Whether to note this baseline in the Phase 1 roadmap README and slice 07's brief.
